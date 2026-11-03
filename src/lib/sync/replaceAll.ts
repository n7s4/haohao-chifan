import type { LocalState } from "./merge";
import {
  buildCookRow,
  buildDerivedItemRow,
  buildManualItemRow,
  buildPlanRow,
  buildPrefsRow,
  buildRecipeRow,
} from "./mutations";
import type { ItemRow } from "./mutations";
import { enqueue } from "./outbox";
import type { RemoteSnapshot } from "./pull";

/**
 * 「整体替换」语义的入队（导入备份用）。
 *
 * 和 `seedFromLocal` 的区别：seed 只增不删（首次登录云端是空的，没有要撤的东西），
 * 这里必须把「上一版有、这一版没有」的东西写成 tombstone。否则用户导入一份更少的
 * 备份后，云端残留的旧餐位会在下一次 pull 里原样长回来。
 *
 * 差量基准不能只看本机 blob：另一台设备加过的收藏、或本机 blob 落后没 pull 过，
 * 云端会有本机 `prev` 里没有的行，那些行同样必须收到 tombstone。所以可选传入
 * `remote`（导入前 `fetchSnapshot()` 的结果），把云端 live 行并进待删集合。
 */
export type ReplaceCounts = { plan: number; items: number; prefs: number; recipes: number };

/** checked / qtyOverrides 的 key 是 `${weekKey}::${itemId}`。 */
function splitWeeklyKey(key: string): { weekKey: string; id: string } | null {
  const index = key.indexOf("::");
  if (index < 0) return null;
  return { weekKey: key.slice(0, index), id: key.slice(index + 2) };
}

function derivedIds(state: LocalState) {
  const map = new Map<string, { weekKey: string; id: string }>();
  for (const key of [
    ...Object.keys(state.checked),
    ...Object.keys(state.qtyOverrides),
    ...Object.keys(state.removed ?? {}),
  ]) {
    const parts = splitWeeklyKey(key);
    if (parts) map.set(key, parts);
  }
  return map;
}

export async function queueReplaceAll(
  userId: string,
  prev: LocalState,
  next: LocalState,
  remote?: RemoteSnapshot | null
): Promise<ReplaceCounts> {
  const counts = await queueLocalDiff(userId, prev, next);
  if (!remote) return counts;
  const swept = await queueRemoteSweep(userId, next, remote);
  return {
    plan: counts.plan + swept.plan,
    items: counts.items + swept.items,
    prefs: counts.prefs + swept.prefs,
    recipes: counts.recipes + swept.recipes,
  };
}

/** 纯本地差量：prev 有、next 没有的写 tombstone，next 有的写 upsert。 */
async function queueLocalDiff(userId: string, prev: LocalState, next: LocalState): Promise<ReplaceCounts> {
  const counts: ReplaceCounts = { plan: 0, items: 0, prefs: 0, recipes: 0 };

  // ------------------------------------------------------------------ plan
  for (const [dayKey, day] of Object.entries(next.plan)) {
    for (const [slot, recipeId] of Object.entries(day ?? {})) {
      if (!recipeId) continue;
      const row = buildPlanRow({ userId, dayKey, slot, recipeId, servings: next.servings[recipeId] ?? 1 });
      await enqueue({ key: `meal_plan_entries:${row.id}`, userId, table: "meal_plan_entries", conflict: "id", row });
      counts.plan += 1;
    }
  }
  for (const [dayKey, day] of Object.entries(prev.plan)) {
    for (const [slot, recipeId] of Object.entries(day ?? {})) {
      if (!recipeId || next.plan[dayKey]?.[slot]) continue;
      const row = buildPlanRow({ userId, dayKey, slot, recipeId: null });
      await enqueue({ key: `meal_plan_entries:${row.id}`, userId, table: "meal_plan_entries", conflict: "id", row });
      counts.plan += 1;
    }
  }
  // ------------------------------------------------- shopping_items（派生）
  const prevDerived = derivedIds(prev);
  const nextDerived = derivedIds(next);
  for (const [key, { weekKey, id }] of nextDerived) {
    const row = buildDerivedItemRow({
      userId,
      weekKey,
      id,
      checked: next.checked[key] ?? false,
      qty: next.qtyOverrides[key] ?? null,
      deleted: Boolean(next.removed?.[key]),
    });
    await enqueue({ key: `shopping_items:${userId}:${weekKey}:${id}`, userId, table: "shopping_items", conflict: "user_id,id", row });
    counts.items += 1;
  }
  for (const [key, { weekKey, id }] of prevDerived) {
    if (nextDerived.has(key)) continue;
    // 派生的“删除”等于用户手动移除，才写 tombstone；只是覆盖值（勾选/数量）在导入后
    // 没了的，清空覆盖值就行，写成 deleted 会让这项食材整周消失。
    const row = prev.removed?.[key]
      ? { ...buildDerivedItemRow({ userId, weekKey, id }), deleted: true }
      : buildDerivedItemRow({ userId, weekKey, id, checked: false, qty: null });
    await enqueue({ key: `shopping_items:${userId}:${weekKey}:${id}`, userId, table: "shopping_items", conflict: "user_id,id", row });
    counts.items += 1;
  }

  // ------------------------------------------------- shopping_items（手动）
  const nextManual = new Map(next.manualItems.filter((item) => item.weekKey).map((item) => [item.id, item]));
  for (const item of next.manualItems) {
    if (!item.weekKey) continue;
    const row = buildManualItemRow({
      userId,
      weekKey: item.weekKey,
      id: item.id,
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      checked: item.checked,
      sources: item.sources ?? [],
    });
    await enqueue({ key: `shopping_items:${userId}:${item.weekKey}:${item.id}`, userId, table: "shopping_items", conflict: "user_id,id", row });
    counts.items += 1;
  }
  for (const item of prev.manualItems) {
    if (!item.weekKey || nextManual.has(item.id)) continue;
    const row = buildManualItemRow({
      userId,
      weekKey: item.weekKey,
      id: item.id,
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      checked: item.checked,
      sources: item.sources ?? [],
      deleted: true,
    });
    await enqueue({ key: `shopping_items:${userId}:${item.weekKey}:${item.id}`, userId, table: "shopping_items", conflict: "user_id,id", row });
    counts.items += 1;
  }

  // ------------------------------------------------------- recipe_prefs
  const recipeIds = new Set<string>([
    ...prev.favorites,
    ...Object.keys(prev.ratings),
    ...next.favorites,
    ...Object.keys(next.ratings),
    ...Object.keys(prev.servings),
    ...Object.keys(next.servings),
  ]);
  for (const recipeId of recipeIds) {
    const row = buildPrefsRow({
      userId,
      recipeId,
      favorite: next.favorites.includes(recipeId),
      rating: next.ratings[recipeId] ?? null,
      servings: next.servings[recipeId] ?? null,
    });
    await enqueue({ key: `recipe_prefs:${userId}:${recipeId}`, userId, table: "recipe_prefs", conflict: "user_id,recipe_id", row });
    counts.prefs += 1;
  }

  // -------------------------------------------------------------- recipes
  // 导入的自建菜要能推上去，否则换台设备下拉不到，排进菜单的格子会显示「取不到」。
  for (const recipe of next.customRecipes ?? []) {
    const row = buildRecipeRow({
      userId,
      id: recipe.id,
      name: recipe.name,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      minutes: recipe.minutes || null,
      tags: recipe.tags,
      subtitle: recipe.subtitle,
      description: recipe.description,
      difficulty: recipe.difficulty,
      calories: recipe.calories,
      heat: recipe.heat,
      art: recipe.art,
      tips: recipe.tips,
      stepMinutes: recipe.stepMinutes,
    });
    await enqueue({ key: `recipes:${userId}:${recipe.id}`, userId, table: "recipes", conflict: "user_id,id", row });
    counts.recipes += 1;
  }

  // ------------------------------------------------------------- cook_log
  const seen = new Set(prev.cookedLog.map((entry) => `${entry.date}|${entry.recipeId}`));
  for (const entry of next.cookedLog) {
    if (seen.has(`${entry.date}|${entry.recipeId}`)) continue;
    const row = buildCookRow({ userId, recipeId: entry.recipeId, cookedOn: entry.date });
    await enqueue({ key: `cook_log:${row.id}`, userId, table: "cook_log", conflict: "id", row });
  }

  return counts;
}

/**
 * 按云端快照补发的 tombstone：云端 live、而目标状态里没有的行，全部撤掉。
 *
 * 单独拆出来是因为它有两个入口：导入时立刻跑一次（`remote` 拉到了），
 * 以及导入时离线、下次同步前补跑（见 `reconcile.ts` 的 pendingReconcile）。
 * 判据只看 `next` 与 `remote`，所以重复执行是幂等的。
 */
export async function queueRemoteSweep(
  userId: string,
  next: LocalState,
  remote: RemoteSnapshot
): Promise<ReplaceCounts> {
  const counts: ReplaceCounts = { plan: 0, items: 0, prefs: 0, recipes: 0 };

  const cleared = new Set<string>();
  for (const row of remote.plan) {
    if (row.deleted || !row.recipe_id) continue;
    const slotKey = `${row.day_key}|${row.slot}`;
    if (next.plan[row.day_key]?.[row.slot] || cleared.has(slotKey)) continue;
    cleared.add(slotKey);
    // id 由 (user_id, day_key, slot) 决定，和本机没拉到时算出来的完全一致。
    const tombstone = buildPlanRow({ userId, dayKey: row.day_key, slot: row.slot, recipeId: null });
    await enqueue({ key: `meal_plan_entries:${tombstone.id}`, userId, table: "meal_plan_entries", conflict: "id", row: tombstone });
    counts.plan += 1;
  }

  // 采购项按 `${week_key}:${id}` 比对——同一 id 换了周，旧周那行也得收掉。
  const liveKeys = new Set<string>();
  for (const [key] of derivedIds(next)) {
    const parts = splitWeeklyKey(key);
    if (parts) liveKeys.add(`${parts.weekKey}:${parts.id}`);
  }
  for (const item of next.manualItems) {
    if (item.weekKey) liveKeys.add(`${item.weekKey}:${item.id}`);
  }
  const clearedItems = new Set<string>();
  for (const item of remote.items) {
    if (item.deleted) continue;
    const key = `${item.week_key}:${item.id}`;
    if (liveKeys.has(key) || clearedItems.has(key)) continue;
    clearedItems.add(key);
    if (item.kind !== "manual" && !next.removed?.[`${item.week_key}::${item.id}`]) {
      // 派生条目不是数据，只是「勾选/数量/移除」三个覆盖值。这里只能清空覆盖值，
      // 不能写 deleted——否则 pull 回来会被当成用户手动移除，把这周的食材整个藏掉。
      const clearedDerived = buildDerivedItemRow({
        userId,
        weekKey: item.week_key,
        id: item.id,
        checked: false,
        qty: null,
      });
      await enqueue({
        key: `shopping_items:${userId}:${item.week_key}:${item.id}`,
        userId,
        table: "shopping_items",
        conflict: "user_id,id",
        row: clearedDerived,
      });
      counts.items += 1;
      continue;
    }
    // 复用云端那行的 name/unit/qty：派生 id 是 `${name}|${unit}`，但手动项拆不出来。
    const row: ItemRow = {
      id: item.id,
      user_id: userId,
      week_key: item.week_key,
      name: item.name,
      unit: item.unit,
      qty: item.qty,
      checked: item.checked,
      sources: item.sources ?? [],
      kind: item.kind === "manual" ? "manual" : "derived",
      deleted: true,
      updated_at: new Date().toISOString(),
    };
    await enqueue({ key: `shopping_items:${userId}:${item.week_key}:${item.id}`, userId, table: "shopping_items", conflict: "user_id,id", row });
    counts.items += 1;
  }

  // prefs 是「整行承载 favorite/rating/servings」，必须清空而不是删行。
  const localRecipeIds = new Set<string>([...next.favorites, ...Object.keys(next.ratings), ...Object.keys(next.servings)]);
  const clearedPrefs = new Set<string>();
  for (const row of remote.prefs) {
    if (clearedPrefs.has(row.recipe_id) || localRecipeIds.has(row.recipe_id)) continue;
    if (!row.favorite && !row.rating && !row.servings) continue;
    clearedPrefs.add(row.recipe_id);
    const prefs = buildPrefsRow({ userId, recipeId: row.recipe_id, favorite: false, rating: null, servings: null });
    await enqueue({ key: `recipe_prefs:${userId}:${row.recipe_id}`, userId, table: "recipe_prefs", conflict: "user_id,recipe_id", row: prefs });
    counts.prefs += 1;
  }

  // 自建菜：云端 live、导入后本地没有的，写 tombstone。内置菜不在云端，不受影响。
  const keptRecipeIds = new Set((next.customRecipes ?? []).map((recipe) => recipe.id));
  const clearedRecipes = new Set<string>();
  for (const row of remote.recipes ?? []) {
    if (row.deleted || clearedRecipes.has(row.id) || keptRecipeIds.has(row.id)) continue;
    clearedRecipes.add(row.id);
    const tombstone = buildRecipeRow({
      userId,
      id: row.id,
      name: row.name,
      ingredients: [],
      steps: [],
      deleted: true,
    });
    await enqueue({ key: `recipes:${userId}:${row.id}`, userId, table: "recipes", conflict: "user_id,id", row: tombstone });
    counts.recipes += 1;
  }

  return counts;
}
