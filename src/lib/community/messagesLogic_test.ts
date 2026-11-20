import { assertEquals } from "jsr:@std/assert";
import {
  badgeText,
  type ChatMessage,
  canCreateGroup,
  dbReason,
  defaultGroupName,
  formatChatTime,
  mergeLatestPage,
  mergeMessages,
  needsTimeSeparator,
  newMessageId,
  pickableMutuals,
  showStrangerHint,
  strangerHint,
  totalUnread,
  toggleSelected,
  validateBody,
  validateGroupName,
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


// ---------------------------------------------------------------- 聊天页

Deno.test("needsTimeSeparator：第一条总显示；相隔 ≥ 5 分钟才显示", () => {
  const a = msg("a", "2026-01-01T00:00:00Z");
  assertEquals(needsTimeSeparator(undefined, a), true);
  assertEquals(needsTimeSeparator(a, msg("b", "2026-01-01T00:04:59Z")), false);
  assertEquals(needsTimeSeparator(a, msg("b", "2026-01-01T00:05:00Z")), true);
  assertEquals(needsTimeSeparator(a, msg("b", "2026-01-01T01:00:00Z")), true);
});

const hintBase = {
  kind: "direct" as const,
  me: "me",
  peerId: "peer",
  peerFollowsMe: false as boolean | undefined,
  messages: [msg("a", "2026-01-01T00:00:00Z", { senderId: "me" })],
  allLoaded: true,
  rejected: false,
};

Deno.test("showStrangerHint：全部历史已加载、对方没发过没关注、我发过 1 条 → 显示", () => {
  assertEquals(showStrangerHint(hintBase), true);
});

Deno.test("showStrangerHint：群聊永不显示", () => {
  assertEquals(showStrangerHint({ ...hintBase, kind: "group" }), false);
  assertEquals(showStrangerHint({ ...hintBase, kind: "group", rejected: true }), false);
});

Deno.test("showStrangerHint：对方关注我 / 关注状态未知 → 不按本地判断", () => {
  assertEquals(showStrangerHint({ ...hintBase, peerFollowsMe: true }), false);
  assertEquals(showStrangerHint({ ...hintBase, peerFollowsMe: undefined }), false);
});

Deno.test("showStrangerHint：历史没加载完不按本地判断", () => {
  assertEquals(showStrangerHint({ ...hintBase, allLoaded: false }), false);
});

Deno.test("showStrangerHint：我还没发 / 只有 pending、failed 不算发过", () => {
  assertEquals(showStrangerHint({ ...hintBase, messages: [] }), false);
  assertEquals(
    showStrangerHint({
      ...hintBase,
      messages: [
        msg("a", "2026-01-01T00:00:00Z", { senderId: "me", pending: true }),
        msg("b", "2026-01-01T00:00:01Z", { senderId: "me", failed: true }),
      ],
    }),
    false,
  );
});

Deno.test("showStrangerHint：对方发过任何一条就永不显示，哪怕上次被拒", () => {
  const messages = [...hintBase.messages, msg("p", "2026-01-01T00:01:00Z", { senderId: "peer" })];
  assertEquals(showStrangerHint({ ...hintBase, messages }), false);
  assertEquals(showStrangerHint({ ...hintBase, messages, rejected: true }), false);
});

Deno.test("showStrangerHint：上次发送被 stranger_limit 拒绝 → 不管加载和关注状态都显示", () => {
  assertEquals(showStrangerHint({ ...hintBase, rejected: true, allLoaded: false, peerFollowsMe: undefined }), true);
  assertEquals(showStrangerHint({ ...hintBase, rejected: true, peerFollowsMe: true }), true);
});

Deno.test("mergeLatestPage：和已有消息有重叠 → 普通合并", () => {
  const existing = [msg("a", "2026-01-01T00:00:01Z"), msg("b", "2026-01-01T00:00:02Z")];
  const page = [msg("b", "2026-01-01T00:00:02Z"), msg("c", "2026-01-01T00:00:03Z")];
  assertEquals(mergeLatestPage(existing, page, 2), { messages: mergeMessages(existing, page), reset: false });
});

Deno.test("mergeLatestPage：整页都比已有的新且没重叠 → 中间可能有断档，丢掉旧的已发消息，保留 pending / failed", () => {
  const pending = msg("p", "2026-01-01T00:00:02Z", { pending: true });
  const failed = msg("f", "2026-01-01T00:00:03Z", { failed: true });
  const existing = [msg("a", "2026-01-01T00:00:01Z"), pending, failed];
  const page = [msg("x", "2026-01-01T01:00:00Z"), msg("y", "2026-01-01T01:00:01Z")];
  assertEquals(mergeLatestPage(existing, page, 2), { messages: mergeMessages([pending, failed], page), reset: true });
});

Deno.test("mergeLatestPage：没满一页说明拿到了全部新消息，不会断档", () => {
  const existing = [msg("a", "2026-01-01T00:00:01Z")];
  const page = [msg("x", "2026-01-01T01:00:00Z")];
  assertEquals(mergeLatestPage(existing, page, 2), { messages: mergeMessages(existing, page), reset: false });
});

Deno.test("mergeLatestPage：本地还没有已发消息 → 普通合并", () => {
  const pending = msg("p", "2026-01-01T00:00:02Z", { pending: true });
  const page = [msg("x", "2026-01-01T01:00:00Z"), msg("y", "2026-01-01T01:00:01Z")];
  assertEquals(mergeLatestPage([pending], page, 2), { messages: mergeMessages([pending], page), reset: false });
});

Deno.test("defaultGroupName: 前 3 个昵称用顿号拼接，截到 30 字", () => {
  assertEquals(defaultGroupName(["小明", "小红", "小刚", "小李"]), "小明、小红、小刚");
  assertEquals(defaultGroupName(["小明", "小红"]), "小明、小红");
  assertEquals(defaultGroupName([]), "");
  const long = defaultGroupName(["一".repeat(20), "二".repeat(20), "三"]);
  assertEquals(Array.from(long).length, 30);
  assertEquals(long.startsWith("一".repeat(20) + "、"), true);
});

Deno.test("validateGroupName: 去首尾空白后 1–30 字", () => {
  assertEquals(validateGroupName("  饭搭子 "), "饭搭子");
  assertEquals(validateGroupName("   "), null);
  assertEquals(validateGroupName("一".repeat(30)), "一".repeat(30));
  assertEquals(validateGroupName("一".repeat(31)), null);
});

Deno.test("toggleSelected: 加入 / 取消，保持选择顺序", () => {
  assertEquals(toggleSelected(["a"], "b"), ["a", "b"]);
  assertEquals(toggleSelected(["a", "b"], "a"), ["b"]);
});

Deno.test("canCreateGroup: 至少选 2 人，加上自己不超过 50", () => {
  assertEquals(canCreateGroup(1), false);
  assertEquals(canCreateGroup(2), true);
  assertEquals(canCreateGroup(49), true);
  assertEquals(canCreateGroup(50), false);
});

Deno.test("pickableMutuals: 去掉我拉黑的和已经在群里的", () => {
  assertEquals(pickableMutuals(["a", "b", "c", "d"], new Set(["b"]), new Set(["c"])), ["a", "d"]);
  assertEquals(pickableMutuals(["a"], new Set()), ["a"]);
});
