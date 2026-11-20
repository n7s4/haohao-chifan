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

/** 客户端生成消息 id（uuid v4）：pending、insert 结果、实时回声共用同一个 id。React Native 没有 crypto.randomUUID，用 Math.random。 */
export function newMessageId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
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

/** 聊天页时间分隔：和上一条相隔这么久就显示时间。 */
export const TIME_GAP_MS = 5 * 60_000;

/** 聊天页里这条消息上方要不要显示时间：第一条总显示，和上一条相隔 ≥ 5 分钟也显示。 */
export function needsTimeSeparator(prev: ChatMessage | undefined, cur: ChatMessage): boolean {
  if (!prev) return true;
  return Date.parse(cur.createdAt) - Date.parse(prev.createdAt) >= TIME_GAP_MS;
}

/**
 * 聊天页输入框上方的陌生人提示。对方在本会话发过任何一条就不再限制，不显示；
 * 上一次发送被 stranger_limit 拒绝就显示；否则只有全部历史都已加载、且知道对方是否关注我时，
 * 才按本地数据走 strangerHint（pending / failed 不算我发过）。
 */
export function showStrangerHint(o: {
  kind: "direct" | "group";
  me: string;
  peerId: string | null;
  /** undefined：关注关系没取到。 */
  peerFollowsMe: boolean | undefined;
  messages: ChatMessage[];
  allLoaded: boolean;
  rejected: boolean;
}): boolean {
  if (o.kind !== "direct") return false;
  const peerHasSent = o.peerId !== null && o.messages.some((m) => m.senderId === o.peerId);
  if (peerHasSent) return false;
  if (o.rejected) return true;
  if (!o.allLoaded || o.peerFollowsMe === undefined) return false;
  const mySent = o.messages.filter((m) => m.senderId === o.me && !m.pending && !m.failed).length;
  return strangerHint({ kind: o.kind, peerFollowsMe: o.peerFollowsMe, peerHasSent, mySent });
}

/**
 * 回到前台时把最新一页并进来。整页都是新消息、和本地已发消息没有重叠时，中间可能断档：
 * 丢掉本地旧的已发消息（保留 pending / failed），reset = true，调用方要重新允许往前翻页。
 */
export function mergeLatestPage(
  existing: ChatMessage[],
  page: ChatMessage[],
  pageSize: number,
): { messages: ChatMessage[]; reset: boolean } {
  const local = existing.filter((m) => m.pending || m.failed);
  const sent = existing.filter((m) => !m.pending && !m.failed);
  const ids = new Set(sent.map((m) => m.id));
  const gap = page.length >= pageSize && sent.length > 0 && !page.some((m) => ids.has(m.id));
  return gap ? { messages: mergeMessages(local, page), reset: true } : { messages: mergeMessages(existing, page), reset: false };
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
