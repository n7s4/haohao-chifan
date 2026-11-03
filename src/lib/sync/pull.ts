import type { ArtKind, Ingredient, Recipe } from "../../data/recipes";
import { normalizeSteps } from "../steps";
import { getSupabase } from "../supabase";

/** 从云端拉取一份快照，交给 store 按 updated_at 合并成本地 blob 的形状。 */

export type RemotePlanRow = {
  day_key: string;
  slot: string;
  recipe_id: string | null;
  servings: number;
  deleted: boolean;
  updated_at: string;
};

export type RemotePrefRow = {
  recipe_id: string;
  favorite: boolean;
  rating: number | null;
  servings: number | null;
  updated_at: string;
};

export type RemoteItemRow = {
  id: string;
  week_key: string;
  name: string;
  qty: number | null;
  unit: string;
  checked: boolean;
  sources: string[] | null;
  kind: string;
  deleted: boolean;
  updated_at: string;
};

export type RemoteCookRow = { recipe_id: string; cooked_on: string; created_at: string };

/** 用户自建菜谱。内置菜不进这张表，所以 `id` 前缀 `custom-` 不会和常量撞。 */
export type RemoteRecipeRow = {
  id: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  minutes: number | null;
  difficulty: string | null;
  calories: number | null;
  tags: string[] | null;
  art: string | null;
  ingredients: unknown;
  steps: unknown;
  heat: string | null;
  tips: string[] | null;
  step_minutes: number[] | null;
  deleted: boolean;
  updated_at: string;
};

export type RemoteSnapshot = {
  plan: RemotePlanRow[];
  prefs: RemotePrefRow[];
  items: RemoteItemRow[];
  cookLog: RemoteCookRow[];
  recipes: RemoteRecipeRow[];
  fetchedAt: string;
};

const ART_KINDS: ArtKind[] = ["pasta", "salad", "rice", "soup", "toast"];

function toIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      qty: typeof item.qty === "number" && Number.isFinite(item.qty) ? item.qty : null,
      unit: typeof item.unit === "string" ? item.unit : "",
      section: item.section === "seasoning" ? ("seasoning" as const) : undefined,
    }))
    .filter((item) => item.name.length > 0);
}

function toStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** 云端一行自建菜谱 → 本地 `Recipe`。字段缺省走和新建时一样的默认值。 */
export function recipeFromRemote(row: RemoteRecipeRow): Recipe {
  const art = ART_KINDS.includes(row.art as ArtKind) ? (row.art as ArtKind) : undefined;
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle ?? "",
    description: row.description ?? "",
    minutes: row.minutes ?? 0,
    difficulty: row.difficulty ?? "",
    calories: row.calories ?? 0,
    tags: toStrings(row.tags),
    art,
    ingredients: toIngredients(row.ingredients),
    steps: normalizeSteps(row.steps),
    heat: row.heat ?? undefined,
    tips: toStrings(row.tips).length ? toStrings(row.tips) : undefined,
    stepMinutes: row.step_minutes ?? undefined,
    updatedAt: row.updated_at,
    custom: true,
  };
}

/** 单次拉取上限；超过说明积压太多，分批只会更慢，这里直接取最近 1000 条。 */
const LIMIT = 1000;

/** 云端是否已有这个用户的数据。首次登录引导用它决定要不要把本地整份推上去。 */
export async function hasRemoteData(): Promise<boolean> {
  const supabase = getSupabase();
  const [plan, prefs, items, recipes] = await Promise.all([
    supabase.from("meal_plan_entries").select("id", { count: "exact", head: true }),
    supabase.from("recipe_prefs").select("recipe_id", { count: "exact", head: true }),
    supabase.from("shopping_items").select("id", { count: "exact", head: true }),
    supabase.from("recipes").select("id", { count: "exact", head: true }).eq("deleted", false),
  ]);
  const error = plan.error ?? prefs.error ?? items.error ?? recipes.error;
  if (error) throw error;
  return (plan.count ?? 0) + (prefs.count ?? 0) + (items.count ?? 0) + (recipes.count ?? 0) > 0;
}

export async function fetchSnapshot(): Promise<RemoteSnapshot> {
  const supabase = getSupabase();
  const [plan, prefs, items, cookLog, recipes] = await Promise.all([
    supabase
      .from("meal_plan_entries")
      .select("day_key,slot,recipe_id,servings,deleted,updated_at")
      .order("updated_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("recipe_prefs")
      .select("recipe_id,favorite,rating,servings,updated_at")
      .order("updated_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("shopping_items")
      .select("id,week_key,name,qty,unit,checked,sources,kind,deleted,updated_at")
      .order("updated_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("cook_log")
      .select("recipe_id,cooked_on,created_at")
      .order("cooked_on", { ascending: false })
      .limit(200),
    supabase
      .from("recipes")
      .select(
        "id,name,subtitle,description,minutes,difficulty,calories,tags,art,ingredients,steps,heat,tips,step_minutes,deleted,updated_at"
      )
      .order("updated_at", { ascending: false })
      .limit(LIMIT),
  ]);

  const firstError = plan.error ?? prefs.error ?? items.error ?? cookLog.error ?? recipes.error;
  if (firstError) throw firstError;

  return {
    plan: (plan.data ?? []) as RemotePlanRow[],
    prefs: (prefs.data ?? []) as RemotePrefRow[],
    items: (items.data ?? []) as RemoteItemRow[],
    cookLog: (cookLog.data ?? []) as RemoteCookRow[],
    recipes: (recipes.data ?? []) as RemoteRecipeRow[],
    fetchedAt: new Date().toISOString(),
  };
}
