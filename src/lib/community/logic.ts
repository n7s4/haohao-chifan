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
  // 「存到我的菜谱」要整道菜复制：以下字段可选，不传时 createRecipe 走原来的默认值。
  subtitle?: string;
  description?: string;
  tags?: string[];
  difficulty?: string;
  calories?: number;
  heat?: string;
  tips?: string[];
  stepMinutes?: number[];
  art?: Recipe["art"];
  origin?: RecipeOrigin;
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

/** 详情页「存到我的菜谱」：内置菜和自己发布的菜不显示（自己的菜本来就在「我的菜谱」里）。 */
export function canSaveToMine(
  cr: Pick<CommunityRecipe, "authorId" | "builtin">,
  currentUserId: string | null,
): boolean {
  return !cr.builtin && !(currentUserId !== null && cr.authorId === currentUserId);
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

export const COMMENT_MAX = 500;

export function validateCommentBody(
  s: string,
): { ok: true; value: string } | { ok: false; error: "empty" | "too_long" } {
  const value = s.trim();
  if (!value) return { ok: false, error: "empty" };
  if (len(value) > COMMENT_MAX) return { ok: false, error: "too_long" };
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
  const { subtitle, description, tags, difficulty, calories, heat, tips, stepMinutes, art } = cr.recipe;
  // 没 path 的图在公开桶里没有对应文件，复制过来只会是永久破图：直接丢掉。
  const steps = r.steps.map((s) => {
    if (!s.images) return s;
    const { images, ...rest } = s;
    const kept = images.filter((img) => img.path);
    return kept.length ? { ...rest, images: kept } : rest;
  });
  return {
    input: {
      name: cr.recipe.name,
      minutes: cr.recipe.minutes,
      ingredients,
      seasonings,
      steps,
      cover: r.cover?.path ? r.cover : null,
      subtitle,
      description,
      tags: [...tags],
      difficulty,
      calories,
      ...(heat ? { heat } : {}),
      ...(tips?.length ? { tips: [...tips] } : {}),
      ...(stepMinutes?.length ? { stepMinutes: [...stepMinutes] } : {}),
      ...(art ? { art } : {}),
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

/**
 * 点赞时本地还不知道赞没赞（刚登录 / 查询失败）：先查一次。查到已经赞过 → 只同步显示（sync），
 * 不发请求、不改计数；查到没赞 → 按用户意图点赞（toggle）。
 */
export function likeAfterLookup(serverLiked: boolean): "sync" | "toggle" {
  return serverLiked ? "sync" : "toggle";
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

/** 回复只有一层：回复别人的回复时，挂到那条回复所在的顶层评论下。 */
export function replyParentId(c: CommentRow): string {
  return c.parentId ?? c.id;
}

/**
 * 长按评论能做什么：本人或菜的作者可「删除」，别人的评论可「举报」（游客也显示，点了去登录）。
 * 已删除的评论（「该评论已删除」占位）没有操作。内置菜 authorId 为 null，只有评论者本人能删。
 */
export function commentActions(
  c: CommentRow,
  viewerId: string | null,
  recipeAuthorId: string | null,
): ("delete" | "report")[] {
  if (c.deleted) return [];
  const own = viewerId !== null && c.userId === viewerId;
  const isAuthor = viewerId !== null && recipeAuthorId !== null && viewerId === recipeAuthorId;
  const out: ("delete" | "report")[] = [];
  if (own || isAuthor) out.push("delete");
  if (!own) out.push("report");
  return out;
}

/** 与 validateCommentBody 同一口径：trim 后按 Unicode 码点计。 */
export function commentLength(s: string): number {
  return len(s.trim());
}

/** 评论时间：刚刚 / N 分钟前 / N 小时前 / N 天前（7 天内）/ M月D日（今年）/ YYYY年M月D日。 */
export function commentTime(iso: string, now: Date): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const diff = now.getTime() - t.getTime();
  const minute = 60 * 1000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  const md = `${t.getMonth() + 1}月${t.getDate()}日`;
  return t.getFullYear() === now.getFullYear() ? md : `${t.getFullYear()}年${md}`;
}

/** 社区列表翻页：追加并按 id 去重；本页不足 pageSize 条说明到底了。 */
export function mergeFeedPage<T extends { id: string }>(
  prev: T[],
  page: T[],
  pageSize: number,
): { items: T[]; hasMore: boolean } {
  const seen = new Set(prev.map((x) => x.id));
  return { items: [...prev, ...page.filter((x) => !seen.has(x.id))], hasMore: page.length >= pageSize };
}
