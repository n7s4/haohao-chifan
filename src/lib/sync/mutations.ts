import type { RecipeStep } from "../steps";
import type { Ingredient } from "../../data/recipes";
import { enqueue } from "./outbox";
import type { SyncTable } from "./outbox";
import { deterministicId, planEntryId } from "./ids";

/**
 * 业务语义 → 表格行的映射。store 只调这里的函数，不拼 SQL 行。
 *
 * 每个 build* 都是纯函数，便于脱离 AsyncStorage/Supabase 单测；
 * queue* 只负责把 row 塞进离线队列。
 */

const nowIso = () => new Date().toISOString();

export type PlanRow = {
  id: string;
  user_id: string;
  week_key: string;
  day_key: string;
  slot: string;
  recipe_id: string | null;
  servings: number;
  deleted: boolean;
  updated_at: string;
};

export type PrefsRow = {
  user_id: string;
  recipe_id: string;
  favorite?: boolean;
  rating?: number | null;
  servings?: number | null;
  updated_at: string;
};

export type ItemRow = {
  id: string;
  user_id: string;
  week_key: string;
  name: string;
  qty: number | null;
  unit: string;
  checked: boolean;
  sources: string[];
  kind: "derived" | "manual";
  deleted: boolean;
  updated_at: string;
};

/** 部分更新行：没给的列不进 payload，upsert 时数据库里的旧值不会被覆盖。 */
export type PatchRow = Partial<ItemRow> & Pick<ItemRow, "id" | "user_id" | "week_key" | "updated_at">;

/**
 * 自建菜谱行。内置 30 道仍走客户端常量、不写库，这一张表只存用户自己录的菜，
 * 所以 pull 时「库里有没有」不会和内置菜打架。
 */
export type RecipeRow = {
  id: string;
  user_id: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  minutes: number | null;
  difficulty: string | null;
  calories: number | null;
  tags: string[];
  art: string | null;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  heat: string | null;
  tips: string[];
  step_minutes: number[];
  deleted: boolean;
  updated_at: string;
};

export type CookRow = {
  id: string;
  user_id: string;
  recipe_id: string;
  cooked_on: string;
};

/** 周键：dayKey 所在周的周一（本地时区，YYYY-MM-DD）。 */
export function weekKeyOf(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildPlanRow(params: {
  userId: string;
  dayKey: string;
  slot: string;
  recipeId: string | null;
  servings?: number;
}): PlanRow {
  const { userId, dayKey, slot, recipeId, servings = 1 } = params;
  return {
    id: planEntryId(userId, dayKey, slot),
    user_id: userId,
    week_key: weekKeyOf(dayKey),
    day_key: dayKey,
    slot,
    recipe_id: recipeId,
    servings,
    // 清空餐位写 tombstone 而不是删行：其它设备拉取时才知道这条被撤了。
    deleted: recipeId === null,
    updated_at: nowIso(),
  };
}

export function buildPrefsRow(params: {
  userId: string;
  recipeId: string;
  favorite?: boolean;
  rating?: number | null;
  servings?: number | null;
}): PrefsRow {
  const { userId, recipeId, favorite, rating, servings } = params;
  const row: PrefsRow = { user_id: userId, recipe_id: recipeId, updated_at: nowIso() };
  // 只带上本次改动的列，避免部分更新把其它列覆盖成默认值。
  if (favorite !== undefined) row.favorite = favorite;
  if (rating !== undefined) row.rating = rating;
  if (servings !== undefined) row.servings = servings;
  return row;
}

/** 派生条目的 id 就是 `${name}|${unit}`，这里拆回去补齐 not null 列。 */
function splitDerivedId(id: string): { name: string; unit: string } {
  const index = id.indexOf("|");
  if (index < 0) return { name: id, unit: "" };
  return { name: id.slice(0, index), unit: id.slice(index + 1) };
}

/**
 * 派生条目（由本周菜单现算）：名称/单位从 id 拆回来，保证插入时 not null 成立；
 * 勾选与数量只在本次真的改了时才进 payload，避免「改数量把勾选抹成 false」。
 */
export function buildDerivedItemRow(params: {
  userId: string;
  weekKey: string;
  id: string;
  name?: string;
  unit?: string;
  checked?: boolean;
  qty?: number | null;
  /** 用户从清单里移除这一项：写 tombstone，别的设备 pull 到也不会再加回来。 */
  deleted?: boolean;
}): PatchRow {
  const { userId, weekKey, id, checked, qty } = params;
  const fallback = splitDerivedId(id);
  const row: PatchRow = {
    id,
    user_id: userId,
    week_key: weekKey,
    name: params.name ?? fallback.name,
    unit: params.unit ?? fallback.unit,
    kind: "derived",
    sources: [],
    deleted: params.deleted ?? false,
    updated_at: nowIso(),
  };
  if (checked !== undefined) row.checked = checked;
  if (qty !== undefined) row.qty = qty;
  return row;
}

/** 手动条目是完整行：新增、改名改量、删除（tombstone）都走这里。 */
export function buildManualItemRow(params: {
  userId: string;
  weekKey: string;
  id: string;
  name: string;
  qty: number | null;
  unit: string;
  checked?: boolean;
  sources?: string[];
  deleted?: boolean;
}): ItemRow {
  const { userId, weekKey, id, name, qty, unit, checked = false, sources = [], deleted = false } = params;
  return {
    id,
    user_id: userId,
    week_key: weekKey,
    name,
    qty,
    unit,
    checked,
    sources,
    kind: "manual",
    deleted,
    updated_at: nowIso(),
  };
}

export function buildRecipeRow(params: {
  userId: string;
  id: string;
  name: string;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  minutes?: number | null;
  tags?: string[];
  deleted?: boolean;
  /**
   * 自建菜的可选字段。以前这些列在行里一律写死 null / []，结果是「本地存了、
   * 一推云端就被抹平」，另一台设备拉回来是空的。加字段时补参数，别再写死。
   */
  subtitle?: string | null;
  description?: string | null;
  difficulty?: string | null;
  calories?: number | null;
  heat?: string | null;
  art?: string | null;
  tips?: string[];
  stepMinutes?: number[];
}): RecipeRow {
  return {
    id: params.id,
    user_id: params.userId,
    name: params.name,
    subtitle: params.subtitle || null,
    description: params.description || null,
    minutes: params.minutes ?? null,
    difficulty: params.difficulty || null,
    calories: params.calories ?? null,
    tags: params.tags ?? [],
    art: params.art || null,
    ingredients: params.ingredients,
    steps: params.steps,
    heat: params.heat || null,
    tips: params.tips ?? [],
    step_minutes: params.stepMinutes ?? [],
    deleted: params.deleted ?? false,
    updated_at: nowIso(),
  };
}

export function buildCookRow(params: { userId: string; recipeId: string; cookedOn: string }): CookRow {
  const { userId, recipeId, cookedOn } = params;
  return {
    id: deterministicId("cook_log", userId, recipeId, cookedOn),
    user_id: userId,
    recipe_id: recipeId,
    cooked_on: cookedOn,
  };
}

// ------------------------------------------------------------------ 入队
// conflict 必须与库里的主键一致；部分唯一索引（plan 的 live slot）不能被
// PostgREST 推断，所以 plan/items/prefs 都按主键列冲突。

function push(table: SyncTable, key: string, conflict: string, row: Record<string, unknown>) {
  // 队列条目必须带归属：同一台设备换号后，A 的残留改动不能用 B 的 token 发出去。
  const userId = String((row as { user_id?: unknown }).user_id ?? "");
  return enqueue({ key, userId, table, conflict, row });
}

export function queuePlanSlot(params: Parameters<typeof buildPlanRow>[0]) {
  const row = buildPlanRow(params);
  return push("meal_plan_entries", `meal_plan_entries:${row.id}`, "id", row);
}

export function queuePrefs(params: Parameters<typeof buildPrefsRow>[0]) {
  const row = buildPrefsRow(params);
  return push("recipe_prefs", `recipe_prefs:${row.user_id}:${row.recipe_id}`, "user_id,recipe_id", row);
}

export function queueDerivedItem(params: Parameters<typeof buildDerivedItemRow>[0]) {
  const row = buildDerivedItemRow(params);
  return push("shopping_items", `shopping_items:${row.user_id}:${row.week_key}:${row.id}`, "user_id,id", row);
}

export function queueManualItem(params: Parameters<typeof buildManualItemRow>[0]) {
  const row = buildManualItemRow(params);
  return push("shopping_items", `shopping_items:${row.user_id}:${row.week_key}:${row.id}`, "user_id,id", row);
}

export function queueRecipe(params: Parameters<typeof buildRecipeRow>[0]) {
  const row = buildRecipeRow(params);
  return push("recipes", `recipes:${row.user_id}:${row.id}`, "user_id,id", row);
}

export function queueCookLog(params: Parameters<typeof buildCookRow>[0]) {
  const row = buildCookRow(params);
  return push("cook_log", `cook_log:${row.id}`, "id", row);
}
