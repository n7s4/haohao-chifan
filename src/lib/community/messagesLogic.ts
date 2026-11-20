/** 私信 / 群聊的纯逻辑：不碰网络、不碰 react-native，可在 Deno 里单测。 */
import type { FailReason } from "./api";

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
};

/** 按 id 去重（incoming 覆盖，等于去掉同 id 的 pending），按 createdAt 升序、同时间按 id。 */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export const MAX_BODY = 1000;

/** 去掉首尾空白后 1–1000 字返回结果，否则 null。 */
export function validateBody(text: string): string | null {
  const t = text.trim();
  return t.length >= 1 && t.length <= MAX_BODY ? t : null;
}

/** 数据库 P0001 的 message → 客户端 reason；未知返回 null。 */
export function dbReason(message: string | undefined): FailReason | null {
  switch (message) {
    case "recipient_unavailable":
      return "unavailable";
    case "stranger_limit":
      return "stranger_limit";
    case "rate_limited":
      return "rate_limited";
    case "group_full":
      return "group_full";
    case "not_mutual":
      return "not_mutual";
    case "forbidden":
      return "auth";
    case "invalid":
      return "invalid";
    default:
      return null;
  }
}

/** 私信里对方没发过、没关注我、我已发过 ≥ 1 条：提示「回复或关注前只能发 1 条」。 */
export function strangerHint(o: {
  kind: "direct" | "group";
  peerFollowsMe: boolean;
  peerHasSent: boolean;
  mySent: number;
}): boolean {
  return o.kind === "direct" && !o.peerHasSent && !o.peerFollowsMe && o.mySent >= 1;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** 今天 HH:mm；昨天 昨天 HH:mm；今年 M月D日；更早 YYYY/M/D。按本地时区。 */
export function formatChatTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days === 0) return hhmm(d);
  if (days === 1) return `昨天 ${hhmm(d)}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export const totalUnread = (list: { unread: number }[]): number => list.reduce((s, c) => s + c.unread, 0);

export const badgeText = (n: number): string => (n > 99 ? "99+" : String(n));
