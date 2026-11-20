import { assertEquals } from "jsr:@std/assert";
import {
  badgeText,
  type ChatMessage,
  dbReason,
  formatChatTime,
  mergeMessages,
  newMessageId,
  strangerHint,
  totalUnread,
  validateBody,
} from "./messagesLogic.ts";

const msg = (id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId: "c1",
  senderId: "u1",
  body: id,
  createdAt,
  ...extra,
});

Deno.test("mergeMessages：按 id 去重，incoming 覆盖", () => {
  const out = mergeMessages([msg("a", "2026-01-01T00:00:01Z")], [msg("a", "2026-01-01T00:00:01Z", { body: "新" })]);
  assertEquals(out.length, 1);
  assertEquals(out[0].body, "新");
});

Deno.test("mergeMessages：真实消息替换同 id 的 pending", () => {
  const out = mergeMessages(
    [msg("a", "2026-01-01T00:00:01Z", { pending: true })],
    [msg("a", "2026-01-01T00:00:02Z")],
  );
  assertEquals(out, [msg("a", "2026-01-01T00:00:02Z")]);
});

Deno.test("mergeMessages：乱序变升序，同时间按 id", () => {
  const out = mergeMessages(
    [msg("c", "2026-01-01T00:00:03Z"), msg("b", "2026-01-01T00:00:01Z")],
    [msg("a", "2026-01-01T00:00:01Z"), msg("d", "2026-01-01T00:00:02Z")],
  );
  assertEquals(out.map((m) => m.id), ["a", "b", "d", "c"]);
});

Deno.test("validateBody：边界", () => {
  assertEquals(validateBody(""), null);
  assertEquals(validateBody("   \n "), null);
  assertEquals(validateBody("a"), "a");
  assertEquals(validateBody("  hi  "), "hi");
  assertEquals(validateBody("a".repeat(1000)), "a".repeat(1000));
  assertEquals(validateBody("a".repeat(1001)), null);
  assertEquals(validateBody(" " + "a".repeat(1000) + " "), "a".repeat(1000));
});

Deno.test("dbReason：每个 code + 未知", () => {
  assertEquals(dbReason("recipient_unavailable"), "unavailable");
  assertEquals(dbReason("stranger_limit"), "stranger_limit");
  assertEquals(dbReason("rate_limited"), "rate_limited");
  assertEquals(dbReason("group_full"), "group_full");
  assertEquals(dbReason("not_mutual"), "not_mutual");
  assertEquals(dbReason("forbidden"), "auth");
  assertEquals(dbReason("invalid"), "invalid");
  assertEquals(dbReason("whatever"), null);
  assertEquals(dbReason(undefined), null);
});

Deno.test("strangerHint：四种情况", () => {
  const base = { kind: "direct" as const, peerFollowsMe: false, peerHasSent: false, mySent: 1 };
  assertEquals(strangerHint(base), true);
  assertEquals(strangerHint({ ...base, kind: "group" }), false);
  assertEquals(strangerHint({ ...base, peerFollowsMe: true }), false);
  assertEquals(strangerHint({ ...base, peerHasSent: true }), false);
  assertEquals(strangerHint({ ...base, mySent: 0 }), false);
});

Deno.test("formatChatTime：今天 / 昨天 / 今年 / 去年", () => {
  const now = new Date(2026, 10, 20, 15, 0);
  assertEquals(formatChatTime(new Date(2026, 10, 20, 9, 5).toISOString(), now), "09:05");
  assertEquals(formatChatTime(new Date(2026, 10, 19, 23, 30).toISOString(), now), "昨天 23:30");
  assertEquals(formatChatTime(new Date(2026, 2, 3, 12, 0).toISOString(), now), "3月3日");
  assertEquals(formatChatTime(new Date(2025, 11, 31, 12, 0).toISOString(), now), "2025/12/31");
});

Deno.test("totalUnread / badgeText", () => {
  assertEquals(totalUnread([{ unread: 2 }, { unread: 3 }]), 5);
  assertEquals(totalUnread([]), 0);
  assertEquals(badgeText(0), "0");
  assertEquals(badgeText(5), "5");
  assertEquals(badgeText(99), "99");
  assertEquals(badgeText(100), "99+");
});

Deno.test("newMessageId：uuid v4 格式且不重复", () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ids = Array.from({ length: 500 }, () => newMessageId());
  for (const id of ids) assertEquals(re.test(id), true, id);
  assertEquals(new Set(ids).size, ids.length);
});
