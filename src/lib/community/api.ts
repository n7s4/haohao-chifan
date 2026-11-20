/**
 * 社区互动的数据访问层。所有函数第一个参数是 SupabaseClient，由调用方注入：
 * 这个文件不 import ../supabase、不碰 react-native / expo，要能在 Deno 里跑集成测试。
 *
 * 错误统一折成 Result：RLS 拒绝 / 0 行受影响 / 目标不存在 → unavailable；
 * fetch 失败 → network；JWT 失效 → auth；参数或 check 约束不过 → invalid。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recipe } from "../../data/recipes";
import { normalizeStepImage, normalizeSteps } from "../steps";
import {
  type CommentRow,
  communityIdFor,
  type CommunityRecipe,
  type ImageCopy,
  missingUploads,
  toSnapshot,
  validateCommentBody,
  validateNickname,
} from "./logic";

export type FailReason = "unavailable" | "network" | "auth" | "invalid";
export type Result<T> = { ok: true; value: T } | { ok: false; reason: FailReason };
export type ReportReason = "ad" | "unfriendly" | "irrelevant" | "other";
export type PublicProfile = { nickname: string; avatarUrl: string | null };

const PRIVATE_BUCKET = "recipe-media";
const PUBLIC_BUCKET = "community-media";
const COPY_CONCURRENCY = 3;
const TABLE = "community_recipes";

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const okVoid: Result<void> = { ok: true, value: undefined };
export const fail = <T>(reason: FailReason): Result<T> => ({ ok: false, reason });

export type AnyError = { code?: string; message?: string; name?: string; status?: number; statusCode?: string };

/** PostgREST / Storage 的错误 → FailReason。status 0 是 postgrest-js 包装的 fetch 异常。 */
export function reasonOf(error: AnyError, status?: number): FailReason {
  if (status === 0 || error.name === "StorageUnknownError" || /fetch|network/i.test(error.message ?? "")) {
    return "network";
  }
  const code = error.code ?? "";
  if (code === "PGRST301" || code === "PGRST302" || code === "PGRST303" || status === 401 || error.status === 401) {
    return "auth";
  }
  if (code === "23514" || code === "22001" || code === "22P02" || code === "23502") return "invalid";
  return "unavailable";
}

/** 每次最多 limit 个并发；任何一个失败就返回该失败（其余已发出的照常跑完）。 */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<Result<void>>): Promise<Result<void>> {
  let next = 0;
  let firstFail: Result<void> | null = null;
  const worker = async () => {
    while (next < items.length && !firstFail) {
      const r = await fn(items[next++]);
      if (!r.ok && !firstFail) firstFail = r;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return firstFail ?? okVoid;
}

// ------------------------------------------------------------------ 行映射

type Row = Record<string, unknown>;

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function rowToCommunityRecipe(row: Row): CommunityRecipe {
  const cover = normalizeStepImage(row.cover);
  const tips = arr<string>(row.tips);
  const stepMinutes = arr<number>(row.step_minutes);
  return {
    id: str(row.id),
    authorId: typeof row.author_id === "string" ? row.author_id : null,
    sourceRecipeId: str(row.source_recipe_id),
    builtin: row.builtin === true,
    status: row.status === "withdrawn" || row.status === "removed" ? row.status : "published",
    likeCount: num(row.like_count),
    commentCount: num(row.comment_count),
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
    recipe: {
      name: str(row.name),
      subtitle: str(row.subtitle),
      description: str(row.description),
      minutes: num(row.minutes),
      difficulty: str(row.difficulty),
      calories: num(row.calories),
      tags: arr<string>(row.tags),
      ...(row.art ? { art: row.art as Recipe["art"] } : {}),
      ...(cover ? { cover } : {}),
      ingredients: arr<Recipe["ingredients"][number]>(row.ingredients),
      steps: normalizeSteps(row.steps),
      ...(typeof row.heat === "string" && row.heat ? { heat: row.heat } : {}),
      ...(tips.length ? { tips } : {}),
      ...(stepMinutes.length ? { stepMinutes } : {}),
    },
  };
}

function rowToComment(row: Row): CommentRow {
  return {
    id: str(row.id),
    parentId: typeof row.parent_id === "string" ? row.parent_id : null,
    replyToUserId: typeof row.reply_to_user_id === "string" ? row.reply_to_user_id : null,
    userId: str(row.user_id),
    body: str(row.body),
    deleted: row.deleted === true,
    createdAt: str(row.created_at),
  };
}

// ------------------------------------------------------------------ 读

export async function listCommunity(
  client: SupabaseClient,
  opts: { sort: "latest" | "hot"; offset: number; limit: number },
): Promise<Result<CommunityRecipe[]>> {
  let q = client.from(TABLE).select("*").eq("status", "published");
  if (opts.sort === "hot") q = q.order("like_count", { ascending: false });
  q = q.order("published_at", { ascending: false }).order("id", { ascending: true });
  const { data, error, status } = await q.range(opts.offset, opts.offset + opts.limit - 1);
  if (error) return fail(reasonOf(error, status));
  return ok((data ?? []).map(rowToCommunityRecipe));
}

/** 只返回 published 的菜；作者自己撤回的也算不可用（RLS 允许作者读，这里显式过滤）。 */
export async function getCommunityRecipe(client: SupabaseClient, id: string): Promise<Result<CommunityRecipe>> {
  const { data, error, status } = await client.from(TABLE).select("*").eq("id", id).eq("status", "published")
    .maybeSingle();
  if (error) return fail(reasonOf(error, status));
  return data ? ok(rowToCommunityRecipe(data)) : fail("unavailable");
}

export async function getCommunityRecipes(
  client: SupabaseClient,
  ids: string[],
): Promise<Result<CommunityRecipe[]>> {
  if (!ids.length) return ok([]);
  const { data, error, status } = await client.from(TABLE).select("*").in("id", ids).eq("status", "published");
  if (error) return fail(reasonOf(error, status));
  return ok((data ?? []).map(rowToCommunityRecipe));
}

export async function findMyPublication(
  client: SupabaseClient,
  userId: string,
  sourceRecipeId: string,
): Promise<Result<CommunityRecipe | null>> {
  const { data, error, status } = await client.from(TABLE).select("*")
    .eq("author_id", userId).eq("source_recipe_id", sourceRecipeId).maybeSingle();
  if (error) return fail(reasonOf(error, status));
  return ok(data ? rowToCommunityRecipe(data) : null);
}

// ------------------------------------------------------------------ 公开桶

async function listPublicFolder(client: SupabaseClient, folder: string): Promise<Result<string[]>> {
  const { data, error } = await client.storage.from(PUBLIC_BUCKET).list(folder, { limit: 1000 });
  if (error) return fail(reasonOf(error));
  return ok((data ?? []).map((f) => `${folder}/${f.name}`));
}

async function removePublic(client: SupabaseClient, paths: string[]): Promise<Result<void>> {
  if (!paths.length) return okVoid;
  const { error } = await client.storage.from(PUBLIC_BUCKET).remove(paths);
  return error ? fail(reasonOf(error)) : okVoid;
}

async function clearPublicFolder(client: SupabaseClient, folder: string): Promise<Result<void>> {
  const listed = await listPublicFolder(client, folder);
  return listed.ok ? removePublic(client, listed.value) : listed;
}

async function copyToPublic(client: SupabaseClient, c: ImageCopy): Promise<Result<void>> {
  const { error } = await client.storage.from(PRIVATE_BUCKET).copy(c.from, c.to, { destinationBucket: PUBLIC_BUCKET });
  return error ? fail(reasonOf(error)) : okVoid;
}

/**
 * 「存到我的菜谱」：把社区菜的图从公开桶复制到本人私有桶（并发 3）。
 * 任何一张失败就尽力删掉已复制的，返回失败——调用方据此不建菜，不留半截。
 */
export async function copyToPrivate(client: SupabaseClient, copies: ImageCopy[]): Promise<Result<void>> {
  const done: string[] = [];
  const copied = await mapLimit(copies, COPY_CONCURRENCY, async (c) => {
    const { error } = await client.storage.from(PUBLIC_BUCKET).copy(c.from, c.to, { destinationBucket: PRIVATE_BUCKET });
    if (error) return fail(reasonOf(error));
    done.push(c.to);
    return okVoid;
  });
  if (!copied.ok && done.length) await client.storage.from(PRIVATE_BUCKET).remove(done);
  return copied;
}

// ------------------------------------------------------------------ 发布 / 撤回

/**
 * 发布或更新到社区。公开桶的写策略要求行已存在且本人是作者，所以首次发布先以 withdrawn 建行，
 * 图片复制完再改成 published。不用 upsert：唯一索引是表达式索引，onConflict 指不到它。
 */
export async function publishRecipe(
  client: SupabaseClient,
  userId: string,
  recipe: Recipe,
): Promise<Result<CommunityRecipe>> {
  if (missingUploads(recipe) > 0) return fail("invalid");

  const existing = await findMyPublication(client, userId, recipe.id);
  if (!existing.ok) return existing;
  if (existing.value?.status === "removed") return fail("unavailable");
  const id = existing.value?.id ?? communityIdFor(userId, recipe.id);
  const { row, copies } = toSnapshot(recipe, id);

  if (!existing.value) {
    const ins = await client.from(TABLE).insert({ ...row, author_id: userId, builtin: false, status: "withdrawn" });
    if (ins.error) return fail(reasonOf(ins.error, ins.status));
  }

  // 增量同步公开目录：路径是 {id}/{imageId}.jpg，imageId 相同即同一张图，已在的不重复复制；
  // 只删新快照里不再用到的图。重新发布已 published 的菜时，不变的图全程可访问。
  const listed = await listPublicFolder(client, id);
  if (!listed.ok) return listed;
  const present = new Set(listed.value);
  const targets = new Set(copies.map((c) => c.to));
  const removed = await removePublic(client, listed.value.filter((p) => !targets.has(p)));
  if (!removed.ok) return removed;
  const toCopy = copies.filter((c) => !present.has(c.to));
  const copied = await mapLimit(toCopy, COPY_CONCURRENCY, (c) => copyToPublic(client, c));
  if (!copied.ok) return copied;

  const { id: _id, ...content } = row;
  const { data, error, status } = await client.from(TABLE)
    .update({ ...content, status: "published" })
    .eq("id", id).eq("author_id", userId)
    .select("*").maybeSingle();
  if (error) return fail(reasonOf(error, status));
  return data ? ok(rowToCommunityRecipe(data)) : fail("unavailable");
}

export async function withdrawRecipe(client: SupabaseClient, communityId: string): Promise<Result<void>> {
  const { error, status, count } = await client.from(TABLE)
    .update({ status: "withdrawn" }, { count: "exact" }).eq("id", communityId);
  if (error) return fail(reasonOf(error, status));
  if (!count) return fail("unavailable");
  const cleared = await clearPublicFolder(client, communityId);
  return cleared.ok ? okVoid : cleared;
}

/**
 * 启动时调用：作者自己 withdrawn（含删菜触发器撤回的）或被管理员 removed 的菜，若公开桶还有图就删掉。
 * 作者能读自己的所有行；公开桶的删策略对 removed 也放行。尽力而为，不报错。
 */
export async function cleanupWithdrawnMedia(client: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await client.from(TABLE).select("id").eq("author_id", userId)
    .in("status", ["withdrawn", "removed"]);
  if (error || !data) return;
  for (const r of data) await clearPublicFolder(client, str(r.id));
}

// ------------------------------------------------------------------ 点赞

/** 重复点赞（主键冲突）、取消本来就没有的赞都算成功；菜不是 published 时 RLS 拒绝 → unavailable。 */
export async function setLike(
  client: SupabaseClient,
  userId: string,
  communityId: string,
  liked: boolean,
): Promise<Result<void>> {
  const likes = client.from("community_likes");
  if (liked) {
    const { error, status } = await likes.insert({ user_id: userId, community_recipe_id: communityId });
    if (!error || error.code === "23505") return okVoid;
    return fail(reasonOf(error, status));
  }
  const del = await likes.delete({ count: "exact" }).eq("user_id", userId).eq("community_recipe_id", communityId);
  if (del.error) return fail(reasonOf(del.error, del.status));
  if (del.count) return okVoid;
  // 0 行：要么本来就没赞（成功），要么菜已撤回、RLS 不让删（unavailable）。本人能读自己的赞，查一下区分。
  const still = await likes.select("user_id").eq("user_id", userId).eq("community_recipe_id", communityId)
    .maybeSingle();
  if (still.error) return fail(reasonOf(still.error, still.status));
  return still.data ? fail("unavailable") : okVoid;
}

export async function myLikes(client: SupabaseClient, userId: string, ids: string[]): Promise<Result<Set<string>>> {
  if (!ids.length) return ok(new Set());
  const { data, error, status } = await client.from("community_likes").select("community_recipe_id")
    .eq("user_id", userId).in("community_recipe_id", ids);
  if (error) return fail(reasonOf(error, status));
  return ok(new Set((data ?? []).map((r) => str(r.community_recipe_id))));
}

// ------------------------------------------------------------------ 评论

const COMMENT_COLS = "id, parent_id, reply_to_user_id, user_id, body, deleted, created_at";

export async function listComments(client: SupabaseClient, communityId: string): Promise<Result<CommentRow[]>> {
  const { data, error, status } = await client.from("community_comments").select(COMMENT_COLS)
    .eq("community_recipe_id", communityId).order("created_at", { ascending: true });
  if (error) return fail(reasonOf(error, status));
  return ok((data ?? []).map(rowToComment));
}

/** 菜已撤回（RLS 42501）或父评论不可见（23503）→ unavailable；正文不合规 → invalid。 */
export async function addComment(
  client: SupabaseClient,
  userId: string,
  communityId: string,
  body: string,
  parentId?: string,
  replyToUserId?: string | null,
): Promise<Result<CommentRow>> {
  const v = validateCommentBody(body);
  if (!v.ok) return fail("invalid");
  const { data, error, status } = await client.from("community_comments")
    .insert({ community_recipe_id: communityId, user_id: userId, body: v.value, parent_id: parentId ?? null,
      reply_to_user_id: parentId ? (replyToUserId ?? null) : null })
    .select(COMMENT_COLS).single();
  if (error) return fail(reasonOf(error, status));
  return ok(rowToComment(data));
}

/** 软删。已经删过的评论再删，guard 抛 23514 → 按成功处理。 */
export async function deleteComment(client: SupabaseClient, commentId: string): Promise<Result<void>> {
  const { error, status, count } = await client.from("community_comments")
    .update({ deleted: true }, { count: "exact" }).eq("id", commentId);
  if (error) return error.code === "23514" ? okVoid : fail(reasonOf(error, status));
  return count ? okVoid : fail("unavailable");
}

// ------------------------------------------------------------------ 举报

/** 只插入：community_reports 没有 select 策略，不能要 representation。重复举报（23505）算成功。 */
export async function report(
  client: SupabaseClient,
  userId: string,
  target: { recipeId: string } | { commentId: string } | { userId: string },
  reason: ReportReason,
): Promise<Result<void>> {
  const { error, status } = await client.from("community_reports").insert({
    reporter_id: userId,
    reason,
    ...("recipeId" in target
      ? { community_recipe_id: target.recipeId }
      : "commentId" in target
        ? { comment_id: target.commentId }
        : { reported_user_id: target.userId }),
  });
  if (!error || error.code === "23505") return okVoid;
  return fail(reasonOf(error, status));
}

// ------------------------------------------------------------------ 公开资料

export async function getProfiles(
  client: SupabaseClient,
  userIds: string[],
): Promise<Result<Map<string, PublicProfile>>> {
  const out = new Map<string, PublicProfile>();
  if (!userIds.length) return ok(out);
  const { data, error, status } = await client.from("public_profiles").select("user_id, nickname, avatar_path, updated_at")
    .in("user_id", userIds);
  if (error) return fail(reasonOf(error, status));
  const bucket = client.storage.from(PUBLIC_BUCKET);
  for (const r of data ?? []) {
    const path = typeof r.avatar_path === "string" && r.avatar_path ? r.avatar_path : null;
    // 头像固定路径覆盖写，带上 updated_at 让图片缓存失效。
    const avatarUrl = path
      ? `${bucket.getPublicUrl(path).data.publicUrl}?v=${encodeURIComponent(str(r.updated_at))}`
      : null;
    out.set(str(r.user_id), { nickname: str(r.nickname), avatarUrl });
  }
  return ok(out);
}

/** 没有公开资料就建一条；已有则不动（不覆盖已有昵称）。 */
export async function ensurePublicProfile(
  client: SupabaseClient,
  userId: string,
  nickname: string,
): Promise<Result<void>> {
  const v = validateNickname(nickname);
  if (!v.ok) return fail("invalid");
  const { error, status } = await client.from("public_profiles").insert({ user_id: userId, nickname: v.value });
  if (!error || error.code === "23505") return okVoid;
  return fail(reasonOf(error, status));
}

/** 改昵称：只更新自己那条；没有资料行 → unavailable。 */
export async function renamePublicProfile(
  client: SupabaseClient,
  userId: string,
  nickname: string,
): Promise<Result<void>> {
  const v = validateNickname(nickname);
  if (!v.ok) return fail("invalid");
  const { error, status, count } = await client.from("public_profiles").update({ nickname: v.value }, { count: "exact" })
    .eq("user_id", userId);
  if (error) return fail(reasonOf(error, status));
  return count ? okVoid : fail("unavailable");
}

/** 私有头像 → community-media/avatars/{userId}.jpg（upsert 覆盖）；null 时删掉公开头像并清空 avatar_path。 */
export async function syncPublicAvatar(
  client: SupabaseClient,
  userId: string,
  privateAvatarPath: string | null,
): Promise<Result<void>> {
  const publicPath = `avatars/${userId}.jpg`;
  const bucket = client.storage.from(PUBLIC_BUCKET);
  if (privateAvatarPath) {
    // 不用 storage.download()：它返回的是 RN 的 Blob，没有 arrayBuffer()。
    // 走签名地址 + fetch().arrayBuffer()，与 media.ts 一致只上传 ArrayBuffer（直接传 Blob 会传成 0 字节）。
    const signed = await client.storage.from(PRIVATE_BUCKET).createSignedUrl(privateAvatarPath, 60);
    if (signed.error) return fail(reasonOf(signed.error));
    const res = await fetch(signed.data.signedUrl).catch(() => null);
    if (!res?.ok) return fail("network");
    const bytes = await res.arrayBuffer();
    const up = await bucket.upload(publicPath, bytes, { upsert: true, contentType: "image/jpeg" });
    if (up.error) return fail(reasonOf(up.error));
  } else {
    const rm = await bucket.remove([publicPath]);
    if (rm.error) return fail(reasonOf(rm.error));
  }
  const { error, status, count } = await client.from("public_profiles")
    .update({ avatar_path: privateAvatarPath ? publicPath : null }, { count: "exact" }).eq("user_id", userId);
  if (error) return fail(reasonOf(error, status));
  return count ? okVoid : fail("unavailable");
}
