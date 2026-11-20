/** 关注 / 拉黑相关的纯逻辑，不依赖 RN，可在 Deno 里测。 */

export type FollowState = "none" | "following" | "mutual" | "followed_by";

export function followState(iFollow: boolean, followsMe: boolean): FollowState {
  if (iFollow) return followsMe ? "mutual" : "following";
  return followsMe ? "followed_by" : "none";
}

const LABELS: Record<FollowState, string> = {
  none: "关注",
  followed_by: "回关",
  following: "已关注",
  mutual: "互相关注",
};

/** 点一下关注按钮之后的状态：没关注 → 关注，已关注 → 取关。 */
export function afterToggle(s: FollowState): FollowState {
  if (s === "none") return "following";
  if (s === "followed_by") return "mutual";
  if (s === "following") return "none";
  return "followed_by";
}

export const isFollowing = (s: FollowState) => s === "following" || s === "mutual";

/** 资料取不到时的兜底昵称（与默认昵称同前缀，不暴露任何账号信息）。 */
export const FALLBACK_NICKNAME = "吃饭的人";

export const followButtonLabel = (s: FollowState): string => LABELS[s];

/** 去掉作者在黑名单里的行；authorOf 返回 null（内置菜等）的行保留。黑名单为空时原样返回。 */
export function hideBlocked<T>(rows: T[], blocked: ReadonlySet<string>, authorOf: (r: T) => string | null): T[] {
  if (blocked.size === 0) return rows;
  return rows.filter((r) => {
    const a = authorOf(r);
    return a === null || !blocked.has(a);
  });
}
