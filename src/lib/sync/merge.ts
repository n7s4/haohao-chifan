import type { Recipe } from "../../data/recipes";
import { recipeFromRemote, type RemoteSnapshot } from "./pull";
import { deterministicId, planEntryId } from "./ids";

/**
 * 把云端快照合进本地 blob。
 *
 * 队列里还没推上去的业务键一律以本地为准（本地是用户刚做的改动，尚未出机）；
 * 其余按「云端快照里最新的那条」落地，等价于 updated_at 后写赢——快照本身已按
 * updated_at 倒序，这里只保留每个业务键的第一条。
 */

export type LocalState = {
  plan: Record<string, Partial<Record<string, string>>>;
  favorites: string[];
  ratings: Record<string, number>;
  servings: Record<string, number>;
  checked: Record<string, boolean>;
  qtyOverrides: Record<string, number>;
  /**
   * 用户从采购清单里移除的派生食材（key 为 `${weekKey}::${itemId}`）。
   * 派生条目是「菜单现算」的，删不掉数据，只能记一条排除；否则同一道菜下周再排、
   * 或另一台设备 pull 回来，它又会自己出现在清单里。
   */
  removed?: Record<string, boolean>;
  manualItems: {
    id: string;
    name: string;
    qty: number | null;
    unit: string;
    checked: boolean;
    weekKey?: string;
    sources?: string[];
  }[];
  cookedLog: { date: string; recipeId: string }[];
  /** 用户自建菜谱。内置菜是常量，不进这里。 */
  customRecipes?: Recipe[];
};

export type MergeStats = {
  plan: number;
  prefs: number;
  items: number;
  cookLog: number;
  recipes: number;
  skippedLocal: number;
};

const prefsKey = (userId: string, recipeId: string) => `recipe_prefs:${userId}:${recipeId}`;
const itemKey = (userId: string, weekKey: string, id: string) => `shopping_items:${userId}:${weekKey}:${id}`;
const recipeKey = (userId: string, id: string) => `recipes:${userId}:${id}`;

export function mergeSnapshot(
  current: LocalState,
  snapshot: RemoteSnapshot,
  userId: string,
  pending: Set<string>
): { state: LocalState; stats: MergeStats } {
  const stats: MergeStats = { plan: 0, prefs: 0, items: 0, cookLog: 0, recipes: 0, skippedLocal: 0 };

  // ------------------------------------------------------------------ plan
  const plan: LocalState["plan"] = { ...current.plan };
  const seenSlots = new Set<string>();
  for (const row of snapshot.plan) {
    if (seenSlots.has(`${row.day_key}|${row.slot}`)) continue;
    seenSlots.add(`${row.day_key}|${row.slot}`);
    if (pending.has(`meal_plan_entries:${planEntryId(userId, row.day_key, row.slot)}`)) {
      stats.skippedLocal += 1;
      continue;
    }
    const day = { ...(plan[row.day_key] ?? {}) };
    if (row.deleted || !row.recipe_id) delete day[row.slot as keyof typeof day];
    else day[row.slot as keyof typeof day] = row.recipe_id;
    if (Object.keys(day).length) plan[row.day_key] = day;
    else delete plan[row.day_key];
    stats.plan += 1;
  }

  // ----------------------------------------------------------------- prefs
  const favorites = new Set(current.favorites);
  const ratings: Record<string, number> = { ...current.ratings };
  const servings: Record<string, number> = { ...current.servings };
  const seenPrefs = new Set<string>();
  for (const row of snapshot.prefs) {
    if (seenPrefs.has(row.recipe_id)) continue;
    seenPrefs.add(row.recipe_id);
    if (pending.has(prefsKey(userId, row.recipe_id))) {
      stats.skippedLocal += 1;
      continue;
    }
    if (row.favorite) favorites.add(row.recipe_id);
    else favorites.delete(row.recipe_id);
    if (row.rating) ratings[row.recipe_id] = row.rating;
    else delete ratings[row.recipe_id];
    // 没有 else 的话，云端把份量清空（null）时本地会留着旧值，下次任何写入又把旧的推回去。
    if (row.servings) servings[row.recipe_id] = row.servings;
    else delete servings[row.recipe_id];
    stats.prefs += 1;
  }

  // ------------------------------------------------------------ items
  const checked: Record<string, boolean> = { ...current.checked };
  const qtyOverrides: Record<string, number> = { ...current.qtyOverrides };
  const removed: Record<string, boolean> = { ...(current.removed ?? {}) };
  const manual = new Map(current.manualItems.map((item) => [item.id, item]));
  const seenItems = new Set<string>();
  for (const row of snapshot.items) {
    const key = `${row.week_key}|${row.id}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key);
    if (pending.has(itemKey(userId, row.week_key, row.id))) {
      stats.skippedLocal += 1;
      continue;
    }
    const slot = `${row.week_key}::${row.id}`;
    if (row.kind === "manual") {
      if (row.deleted) manual.delete(row.id);
      else
        manual.set(row.id, {
          id: row.id,
          name: row.name,
          qty: row.qty,
          unit: row.unit,
          checked: row.checked,
          weekKey: row.week_key,
          sources: row.sources ?? undefined,
        });
    } else if (row.deleted) {
      // 派生条目的 tombstone = 用户在这一周把它移除了。不记下来，下次 pull 或下周
      // 重排同一道菜时它会自己长回来。
      removed[slot] = true;
      delete checked[slot];
      delete qtyOverrides[slot];
    } else {
      // 派生条目的数量/勾选是覆盖值，名称与总量由本周菜单现算。
      delete removed[slot];
      if (row.checked) checked[slot] = true;
      else delete checked[slot];
      if (row.qty !== null) qtyOverrides[slot] = row.qty;
      else delete qtyOverrides[slot];
    }
    stats.items += 1;
  }

  // -------------------------------------------------------------- cook log
  const cooked = new Map<string, { date: string; recipeId: string }>();
  for (const entry of current.cookedLog) cooked.set(`${entry.date}|${entry.recipeId}`, entry);
  for (const row of snapshot.cookLog) {
    const id = deterministicId("cook_log", userId, row.recipe_id, row.cooked_on);
    if (pending.has(`cook_log:${id}`)) continue;
    cooked.set(`${row.cooked_on}|${row.recipe_id}`, { date: row.cooked_on, recipeId: row.recipe_id });
    stats.cookLog += 1;
  }
  const cookedLog = [...cooked.values()]
    .sort((a, b) => (a.date === b.date ? a.recipeId.localeCompare(b.recipeId) : b.date.localeCompare(a.date)))
    .slice(0, 200);

  // ------------------------------------------------------------- recipes
  // 和其它业务键一样以云端为准：还没推上去的行在 pending 里，上面已跳过。
  // 不比较本地 updatedAt——两端时钟不一致时会把云端的新版本永久挡住。
  const customById = new Map<string, Recipe>();
  for (const recipe of current.customRecipes ?? []) customById.set(recipe.id, recipe);
  const seenRecipes = new Set<string>();
  for (const row of snapshot.recipes ?? []) {
    if (seenRecipes.has(row.id)) continue;
    seenRecipes.add(row.id);
    if (pending.has(recipeKey(userId, row.id))) {
      stats.skippedLocal += 1;
      continue;
    }
    if (row.deleted) customById.delete(row.id);
    else customById.set(row.id, recipeFromRemote(row));
    stats.recipes += 1;
  }

  return {
    state: {
      plan,
      favorites: [...favorites],
      ratings,
      servings,
      checked,
      qtyOverrides,
      removed,
      manualItems: [...manual.values()],
      cookedLog,
      customRecipes: [...customById.values()],
    },
    stats,
  };
}
