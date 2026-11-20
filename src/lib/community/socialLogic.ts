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

export const followButtonLabel = (s: FollowState): string => LABELS[s];

/** 去掉作者在黑名单里的行；authorOf 返回 null（内置菜等）的行保留。黑名单为空时原样返回。 */
export function hideBlocked<T>(rows: T[], blocked: ReadonlySet<string>, authorOf: (r: T) => string | null): T[] {
  if (blocked.size === 0) return rows;
  return rows.filter((r) => {
    const a = authorOf(r);
    return a === null || !blocked.has(a);
  });
}
