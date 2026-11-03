import AsyncStorage from "@react-native-async-storage/async-storage";

import type { LocalState } from "./merge";
import {
  buildCookRow,
  buildDerivedItemRow,
  buildManualItemRow,
  buildPlanRow,
  buildPrefsRow,
  buildRecipeRow,
  queuePlanSlot,
} from "./mutations";
import { enqueue } from "./outbox";

/**
 * 首次登录的「本地优先」引导。
 *
 * 一个已经用了几周的用户第一次登录时，云端是空的；如果直接 pull，空快照会把
 * 本地菜单整个盖掉。所以第一次同步前先把本地状态整份推上去，之后再走正常的
 * flush → pull。用 seeded 标记按 userId 记录，只做一次。
 */

const SEED_PREFIX = "haohao-chifan:seeded:";

export async function isSeeded(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEED_PREFIX + userId)) === "1";
  } catch {
    return false;
  }
}

export async function markSeeded(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SEED_PREFIX + userId, "1");
  } catch {
    // 标记写失败最多导致下次再推一遍；所有写入都是幂等 upsert，不会产生重复行。
  }
}

export function hasLocalData(state: LocalState): boolean {
  return (
    Object.keys(state.plan).length > 0 ||
    state.favorites.length > 0 ||
    state.manualItems.length > 0 ||
    Object.keys(state.checked).length > 0 ||
    Object.keys(state.qtyOverrides).length > 0 ||
    Object.keys(state.removed ?? {}).length > 0 ||
    Object.keys(state.ratings).length > 0 ||
    Object.keys(state.servings).length > 0 ||
    (state.customRecipes?.length ?? 0) > 0 ||
    state.cookedLog.length > 0
  );
}

/** 把整份本地状态铺进队列。全部是幂等 upsert，重复执行安全。 */
export async function seedFromLocal(userId: string, state: LocalState): Promise<number> {
  let count = 0;

  for (const [dayKey, day] of Object.entries(state.plan)) {
    for (const [slot, recipeId] of Object.entries(day)) {
      if (!recipeId) continue;
      const row = buildPlanRow({ userId, dayKey, slot, recipeId });
      await enqueue({ key: `meal_plan_entries:${row.id}`, table: "meal_plan_entries", conflict: "id", row });
      count += 1;
    }
  }

  const recipeIds = new Set<string>([
    ...state.favorites,
    ...Object.keys(state.ratings),
    ...Object.keys(state.servings),
  ]);
  for (const recipeId of recipeIds) {
    const row = buildPrefsRow({
      userId,
      recipeId,
      favorite: state.favorites.includes(recipeId),
      rating: state.ratings[recipeId] ?? null,
      servings: state.servings[recipeId] ?? null,
    });
    await enqueue({
      key: `recipe_prefs:${userId}:${recipeId}`,
      table: "recipe_prefs",
      conflict: "user_id,recipe_id",
      row,
    });
    count += 1;
  }

  // checked / qtyOverrides 的 key 是 `${weekKey}::${itemId}`，周键直接取出来用。
  const weeklyItems = new Map<string, { weekKey: string; id: string }>();
  for (const key of [
    ...Object.keys(state.checked),
    ...Object.keys(state.qtyOverrides),
    ...Object.keys(state.removed ?? {}),
  ]) {
    const index = key.indexOf("::");
    if (index < 0) continue;
    const weekKey = key.slice(0, index);
    const id = key.slice(index + 2);
    weeklyItems.set(key, { weekKey, id });
  }
  for (const [key, { weekKey, id }] of weeklyItems) {
    const row = buildDerivedItemRow({
      userId,
      weekKey,
      id,
      checked: state.checked[key] ?? false,
      qty: state.qtyOverrides[key] ?? null,
      deleted: Boolean(state.removed?.[key]),
    });
    await enqueue({ key: `shopping_items:${userId}:${weekKey}:${id}`, table: "shopping_items", conflict: "user_id,id", row });
    count += 1;
  }

  for (const item of state.manualItems) {
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
    await enqueue({
      key: `shopping_items:${userId}:${item.weekKey}:${item.id}`,
      table: "shopping_items",
      conflict: "user_id,id",
      row,
    });
    count += 1;
  }

  for (const recipe of state.customRecipes ?? []) {
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
    count += 1;
  }

  for (const entry of state.cookedLog) {
    const row = buildCookRow({ userId, recipeId: entry.recipeId, cookedOn: entry.date });
    await enqueue({ key: `cook_log:${row.id}`, table: "cook_log", conflict: "id", row });
    count += 1;
  }

  return count;
}

export { queuePlanSlot };
