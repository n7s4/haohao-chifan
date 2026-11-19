/**
 * 社区互动的纯逻辑。只允许 import 纯类型模块：这个文件要能在 Deno（单测、Edge Function）里跑，
 * 不能碰 react-native / expo / supabase，也不能 import src/state/store.tsx。
 */
import type { Recipe } from "../../data/recipes";
import type { RecipeStep, StepImage } from "../steps";
import { deterministicId } from "../sync/ids";

export type CommunityRecipe = {
  id: string;
  authorId: string | null;
  sourceRecipeId: string;
  builtin: boolean;
  status: "published" | "withdrawn" | "removed";
  likeCount: number;
  commentCount: number;
  publishedAt: string | null;
  recipe: Omit<Recipe, "id" | "custom" | "updatedAt">;
};

/** 结构上与 store.tsx 的 CustomRecipeInput 一致（不 import 它，避免拉进 react-native）。 */
export type SnapshotRecipeInput = {
  name: string;
  minutes?: number | null;
  ingredients: { name: string; qty: number | null; unit: string }[];
  seasonings?: { name: string; qty: number | null; unit: string }[];
  steps: RecipeStep[];
  cover?: StepImage | null;
};

export type RecipeOrigin = { communityId: string; authorNickname: string };

export type ImageCopy = { from: string; to: string };

export const COMMUNITY_PREFIX = "community:";

export function communityFavoriteId(id: string): string {
  return COMMUNITY_PREFIX + id;
}

export function parseCommunityFavoriteId(fav: string): string | null {
  return fav.startsWith(COMMUNITY_PREFIX) ? fav.slice(COMMUNITY_PREFIX.length) : null;
}

export function favoriteIdFor(
  cr: Pick<CommunityRecipe, "id" | "authorId" | "sourceRecipeId" | "builtin">,
  currentUserId: string | null,
): string {
  if (cr.builtin || (currentUserId !== null && cr.authorId === currentUserId)) {
    return cr.sourceRecipeId;
  }
  return communityFavoriteId(cr.id);
}

/** 本周计划的候选池：社区菜收藏不进计划，过滤后为空则退回全部菜。 */
export function planPool(favorites: string[], allRecipeIds: string[]): string[] {
  const pool = favorites.filter((id) => !id.startsWith(COMMUNITY_PREFIX));
  return pool.length ? pool : allRecipeIds;
}

export function defaultNickname(rand: () => number): string {
  const n = Math.min(9999, Math.max(0, Math.floor(rand() * 10000)));
  return "吃饭的人" + String(n).padStart(4, "0");
}

const len = (s: string) => Array.from(s).length;

export function validateNickname(
  s: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = s.trim();
  if (!value) return { ok: false, error: "昵称不能为空" };
  if (len(value) > 20) return { ok: false, error: "昵称最多 20 个字" };
  if (value.includes("@")) return { ok: false, error: "昵称不能包含 @" };
  return { ok: true, value };
}

export function validateCommentBody(
  s: string,
): { ok: true; value: string } | { ok: false; error: "empty" | "too_long" } {
  const value = s.trim();
  if (!value) return { ok: false, error: "empty" };
  if (len(value) > 500) return { ok: false, error: "too_long" };
  return { ok: true, value };
}

function allImages(recipe: Pick<Recipe, "cover" | "steps">): StepImage[] {
  const out: StepImage[] = [];
  if (recipe.cover) out.push(recipe.cover);
  for (const step of recipe.steps) for (const img of step.images ?? []) out.push(img);
  return out;
}

export function missingUploads(recipe: Pick<Recipe, "cover" | "steps">): number {
  return allImages(recipe).filter((img) => !img.path).length;
}

/** 去掉 localUri，路径改成 toPath(image)；有原路径的图记入复制清单。 */
function rewriteImages(
  cover: StepImage | undefined | null,
  steps: RecipeStep[],
  toPath: (img: StepImage) => string,
): { cover: StepImage | undefined; steps: RecipeStep[]; copies: ImageCopy[] } {
  const copies: ImageCopy[] = [];
  const rewrite = (img: StepImage): StepImage => {
    const { localUri: _drop, ...rest } = img;
    if (!img.path) return rest;
    const to = toPath(img);
    copies.push({ from: img.path, to });
    return { ...rest, path: to };
  };
  const newCover = cover ? rewrite(cover) : undefined;
  const newSteps = steps.map((s) => (s.images ? { ...s, images: s.images.map(rewrite) } : { ...s }));
  return { cover: newCover, steps: newSteps, copies };
}

/**
 * 首次发布时社区菜的 id：由作者 + 私有菜 id 确定性生成。
 * 不用 crypto.randomUUID：RN 运行时没有它（项目也没装 polyfill）。
 */
export function communityIdFor(userId: string, sourceRecipeId: string): string {
  return deterministicId(userId, "community", sourceRecipeId);
}

export function toSnapshot(
  recipe: Recipe,
  communityId: string,
): { row: Record<string, unknown>; copies: ImageCopy[] } {
  const r = rewriteImages(recipe.cover, recipe.steps, (img) => `${communityId}/${img.id}.jpg`);
  const row: Record<string, unknown> = {
    id: communityId,
    source_recipe_id: recipe.id,
    name: recipe.name,
    subtitle: recipe.subtitle,
    description: recipe.description,
    minutes: recipe.minutes,
    difficulty: recipe.difficulty,
    calories: recipe.calories,
    tags: recipe.tags,
    art: recipe.art ?? null,
    cover: r.cover ?? null,
    ingredients: recipe.ingredients,
    steps: r.steps,
    heat: recipe.heat ?? null,
    tips: recipe.tips ?? [],
    step_minutes: recipe.stepMinutes ?? [],
  };
  return { row, copies: r.copies };
}

export function fromSnapshot(
  cr: CommunityRecipe,
  userId: string,
  newRecipeId: string,
  authorNickname: string,
): { input: SnapshotRecipeInput; origin: RecipeOrigin; copies: ImageCopy[] } {
  const r = rewriteImages(
    cr.recipe.cover,
    cr.recipe.steps,
    (img) => `${userId}/${newRecipeId}/${img.id}.jpg`,
  );
  const pick = ({ name, qty, unit }: { name: string; qty: number | null; unit: string }) => ({ name, qty, unit });
  const ingredients = cr.recipe.ingredients.filter((i) => i.section !== "seasoning").map(pick);
  const seasonings = cr.recipe.ingredients.filter((i) => i.section === "seasoning").map(pick);
  return {
    input: {
      name: cr.recipe.name,
      minutes: cr.recipe.minutes,
      ingredients,
      seasonings,
      steps: r.steps,
      cover: r.cover ?? null,
    },
    origin: { communityId: cr.id, authorNickname },
    copies: r.copies,
  };
}

/** 点赞的乐观更新：next 立刻显示，请求失败时回到 rollback。计数不会变成负数。 */
export function applyLikeToggle(state: { liked: boolean; count: number }): {
  next: { liked: boolean; count: number };
  rollback: { liked: boolean; count: number };
} {
  const liked = !state.liked;
  const count = liked ? state.count + 1 : Math.max(0, state.count - 1);
  return { next: { liked, count }, rollback: { ...state } };
}

export type CommentRow = {
  id: string;
  parentId: string | null;
  userId: string;
  body: string;
  deleted: boolean;
  createdAt: string;
};

export function threadComments(rows: CommentRow[]): { comment: CommentRow; replies: CommentRow[] }[] {
  const byTime = (a: CommentRow, b: CommentRow) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  const replies = new Map<string, CommentRow[]>();
  for (const r of rows) {
    if (r.parentId && !r.deleted) replies.set(r.parentId, [...(replies.get(r.parentId) ?? []), r]);
  }
  return rows
    .filter((r) => !r.parentId)
    .map((comment) => ({ comment, replies: (replies.get(comment.id) ?? []).sort(byTime) }))
    .filter((t) => !t.comment.deleted || t.replies.length > 0)
    .sort((a, b) => -byTime(a.comment, b.comment));
}
