import type { Recipe } from "../../data/recipes";
import type { LocalState } from "./merge";

/**
 * 游客态与账号态之间的合并。
 *
 * 场景：A 退出登录后，用户在游客态继续改菜单，再登录回 A。这时既不能静默丢掉
 * 游客那段改动（用户视角就是「我下午改的没了」），也不能不打招呼直接覆盖账号
 * 数据（会把云端拉下来的内容冲掉）。所以由用户选一次，选完记住，之后不再问。
 *
 * 合并规则：以游客为准做并集，游客有的业务键覆盖账号的（游客是刚改的那份），
 * 账号独有的键保留。
 */

export type MergeableState = LocalState & {
  carryQty?: Record<string, number>;
  carried?: Record<string, string[]>;
};

export function hasContent(state: Partial<MergeableState> | null | undefined): boolean {
  if (!state) return false;
  return (
    Object.values(state.plan ?? {}).some((day) => Object.keys(day ?? {}).length > 0) ||
    (state.favorites?.length ?? 0) > 0 ||
    (state.manualItems?.length ?? 0) > 0 ||
    Object.keys(state.checked ?? {}).length > 0 ||
    Object.keys(state.qtyOverrides ?? {}).length > 0 ||
    Object.keys(state.removed ?? {}).length > 0 ||
    Object.keys(state.ratings ?? {}).length > 0 ||
    Object.keys(state.servings ?? {}).length > 0 ||
    (state.customRecipes?.length ?? 0) > 0 ||
    (state.cookedLog?.length ?? 0) > 0
  );
}

export function mergeGuestIntoAccount(
  account: Partial<MergeableState> | null | undefined,
  guest: Partial<MergeableState> | null | undefined
): MergeableState {
  const base = account ?? {};
  const extra = guest ?? {};

  const plan: LocalState["plan"] = { ...(base.plan ?? {}) };
  Object.entries(extra.plan ?? {}).forEach(([dayKey, day]) => {
    plan[dayKey] = { ...(plan[dayKey] ?? {}), ...(day ?? {}) };
  });

  const manual = new Map<string, LocalState["manualItems"][number]>();
  (base.manualItems ?? []).forEach((item) => manual.set(item.id, item));
  (extra.manualItems ?? []).forEach((item) => manual.set(item.id, item));

  // 自建菜按 id 取并集，游客那份覆盖同 id（游客是刚改的）。
  const customRecipeMap = new Map<string, Recipe>();
  [...(base.customRecipes ?? []), ...(extra.customRecipes ?? [])].forEach((recipe) =>
    customRecipeMap.set(recipe.id, recipe)
  );

  const cooked = new Map<string, { date: string; recipeId: string }>();
  [...(base.cookedLog ?? []), ...(extra.cookedLog ?? [])].forEach((entry) =>
    cooked.set(`${entry.date}|${entry.recipeId}`, entry)
  );

  return {
    plan,
    favorites: [...new Set([...(extra.favorites ?? []), ...(base.favorites ?? [])])],
    ratings: { ...(base.ratings ?? {}), ...(extra.ratings ?? {}) },
    servings: { ...(base.servings ?? {}), ...(extra.servings ?? {}) },
    checked: { ...(base.checked ?? {}), ...(extra.checked ?? {}) },
    qtyOverrides: { ...(base.qtyOverrides ?? {}), ...(extra.qtyOverrides ?? {}) },
    removed: { ...(base.removed ?? {}), ...(extra.removed ?? {}) },
    manualItems: [...manual.values()],
    customRecipes: [...customRecipeMap.values()],
    cookedLog: [...cooked.values()]
      .sort((a, b) => (a.date === b.date ? a.recipeId.localeCompare(b.recipeId) : b.date.localeCompare(a.date)))
      .slice(0, 200),
    carryQty: { ...(base.carryQty ?? {}), ...(extra.carryQty ?? {}) },
    carried: { ...(base.carried ?? {}), ...(extra.carried ?? {}) },
  };
}
