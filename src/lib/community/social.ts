/**
 * 关注 / 拉黑的数据访问层。和 api.ts 一样：第一个参数是注入的 SupabaseClient，返回 Result，
 * 不碰 react-native / expo，可在 Deno 集成测试里跑。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, okVoid, reasonOf, type Result, rowToCommunityRecipe } from "./api";
import type { CommunityRecipe } from "./logic";
import { type FollowState, followState } from "./socialLogic";

export const FOLLOWS_PAGE = 30;

export type SocialStats = { following: number; followers: number; iFollow: boolean; followsMe: boolean };
export type FollowEntry = { userId: string; createdAt: string };

/** 关注。重复关注（23505）算成功；任一方拉黑（P0001 follow_blocked）→ unavailable。 */
export async function follow(client: SupabaseClient, me: string, target: string): Promise<Result<void>> {
  const { error, status } = await client.from("follows").insert({ follower_id: me, followee_id: target });
  if (!error || error.code === "23505") return okVoid;
  if (error.code === "P0001") return fail("unavailable");
  return fail(reasonOf(error, status));
}

/** 取关。本来就没关注（0 行）也算成功。 */
export async function unfollow(client: SupabaseClient, me: string, target: string): Promise<Result<void>> {
  const { error, status } = await client.from("follows").delete().eq("follower_id", me).eq("followee_id", target);
  return error ? fail(reasonOf(error, status)) : okVoid;
}

export async function getSocialStats(client: SupabaseClient, target: string): Promise<Result<SocialStats>> {
  const { data, error, status } = await client.rpc("social_stats", { target });
  if (error) return fail(reasonOf(error, status));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return fail("unavailable");
  return ok({
    following: Number(row.following_count) || 0,
    followers: Number(row.follower_count) || 0,
    iFollow: row.i_follow === true,
    followsMe: row.follows_me === true,
  });
}

/** userId 关注的人（following）或 userId 的粉丝（followers），按时间倒序，每页 FOLLOWS_PAGE 条；before 是上一页最后一条的 createdAt。 */
export async function listFollows(
  client: SupabaseClient,
  userId: string,
  kind: "following" | "followers",
  before?: string,
): Promise<Result<FollowEntry[]>> {
  const self = kind === "following" ? "follower_id" : "followee_id";
  const other = kind === "following" ? "followee_id" : "follower_id";
  let q = client.from("follows").select(`${other}, created_at`).eq(self, userId);
  if (before) q = q.lt("created_at", before);
  const { data, error, status } = await q.order("created_at", { ascending: false }).limit(FOLLOWS_PAGE);
  if (error) return fail(reasonOf(error, status));
  return ok(
    (data ?? []).map((r: Record<string, unknown>) => ({ userId: String(r[other]), createdAt: String(r.created_at) })),
  );
}

/** 我和一批用户之间的关注关系。不在结果里的 id（包括我自己）按 none 处理。 */
export async function relationsTo(
  client: SupabaseClient,
  me: string,
  ids: string[],
): Promise<Result<Map<string, FollowState>>> {
  const out = new Map<string, FollowState>();
  const others = ids.filter((id) => id !== me);
  if (!others.length) return ok(out);
  const [mine, theirs] = await Promise.all([
    client.from("follows").select("followee_id").eq("follower_id", me).in("followee_id", others),
    client.from("follows").select("follower_id").eq("followee_id", me).in("follower_id", others),
  ]);
  if (mine.error) return fail(reasonOf(mine.error, mine.status));
  if (theirs.error) return fail(reasonOf(theirs.error, theirs.status));
  const iFollow = new Set((mine.data ?? []).map((r) => String(r.followee_id)));
  const followsMe = new Set((theirs.data ?? []).map((r) => String(r.follower_id)));
  for (const id of others) out.set(id, followState(iFollow.has(id), followsMe.has(id)));
  return ok(out);
}

/** 拉黑。重复拉黑算成功；数据库会同时删除双方之间的关注。 */
export async function block(client: SupabaseClient, me: string, target: string): Promise<Result<void>> {
  const { error, status } = await client.from("blocks").insert({ blocker_id: me, blocked_id: target });
  if (!error || error.code === "23505") return okVoid;
  return fail(reasonOf(error, status));
}

export async function unblock(client: SupabaseClient, me: string, target: string): Promise<Result<void>> {
  const { error, status } = await client.from("blocks").delete().eq("blocker_id", me).eq("blocked_id", target);
  return error ? fail(reasonOf(error, status)) : okVoid;
}

/** 我拉黑的人，最近的在前。 */
export async function myBlocks(client: SupabaseClient, me: string): Promise<Result<string[]>> {
  const { data, error, status } = await client.from("blocks").select("blocked_id").eq("blocker_id", me)
    .order("created_at", { ascending: false });
  if (error) return fail(reasonOf(error, status));
  return ok((data ?? []).map((r) => String(r.blocked_id)));
}

/** 某人发布在社区、当前仍是 published 的菜，最新的在前。 */
export async function listUserRecipes(client: SupabaseClient, userId: string): Promise<Result<CommunityRecipe[]>> {
  const { data, error, status } = await client.from("community_recipes").select("*")
    .eq("author_id", userId).eq("status", "published")
    .order("published_at", { ascending: false }).limit(60);
  if (error) return fail(reasonOf(error, status));
  return ok((data ?? []).map(rowToCommunityRecipe));
}
