import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { AppText, usePressScale } from "../../components/Common";
import { Avatar } from "../../components/community/Avatar";
import { ActionSheet, ReportSheet } from "../../components/community/ReportSheet";
import { BackIcon } from "../../components/Icons";
import { Toast, useToast } from "../../components/Toast";
import {
  type FailReason,
  getProfiles,
  type PublicProfile,
  report,
  type ReportReason,
  type Result,
} from "../../lib/community/api";
import {
  type ConversationInfo,
  getConversation,
  listMembers,
  listMessages,
  markRead,
  type MemberEntry,
  MESSAGES_PAGE,
  sendMessage,
  subscribeMessages,
} from "../../lib/community/messages";
import {
  type ChatMessage,
  formatChatTime,
  MAX_BODY,
  mergeLatestPage,
  mergeMessages,
  needsTimeSeparator,
  newMessageId,
  showStrangerHint,
  validateBody,
} from "../../lib/community/messagesLogic";
import { getSocialStats } from "../../lib/community/social";
import { FALLBACK_NICKNAME, hideBlocked } from "../../lib/community/socialLogic";
import { useBlocks } from "../../lib/community/useBlocks";
import { failMessage, useCommunityProfile } from "../../lib/community/useCommunityProfile";
import { useUnread } from "../../lib/community/useUnread";
import { getSupabase } from "../../lib/supabase";
import { useAuth } from "../../lib/useAuth";
import { colors, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;
const DELETED_USER = "已注销用户";
const STRANGER_HINT = "对方回复或关注你之前，只能发送 1 条消息";
/** 收到别人的消息时 markRead 的最短间隔。 */
const MARK_READ_GAP_MS = 2000;

/** 网络异常（fetch 直接抛）也折成 Result。 */
const settle = <T,>(p: Promise<Result<T>>): Promise<Result<T>> =>
  p.catch((): Result<T> => ({ ok: false, reason: "network" }));

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/messages");
};

/** 发送失败的提示：私信被拒统一说「对方暂时无法接收消息」，不说明是被拉黑。 */
function sendFailText(reason: FailReason, kind: "direct" | "group"): string {
  if (reason === "unavailable") return kind === "direct" ? "对方暂时无法接收消息" : "没发出去，你可能已经不在这个群里了";
  if (reason === "network" || reason === "auth" || reason === "stranger_limit" || reason === "rate_limited") {
    return failMessage(reason);
  }
  return "没发出去，再试一次";
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; reason: FailReason }
  | { status: "ready"; conv: ConversationInfo; members: MemberEntry[] };

/** 聊天页：私信 / 群聊。登录用户和会话 id 变化时整页重建（key），状态不会串。 */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { ready, userId } = useAuth();
  if (ready && userId && id) return <Chat key={`${userId}:${id}`} conversationId={id} me={userId} />;
  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <IconButton label="返回" onPress={goBack}>
          <BackIcon size={22} color={colors.ink} />
        </IconButton>
      </View>
      <View style={styles.center}>
        {!ready ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <>
            <AppText size={14} color={colors.muted}>登录后才能收发消息</AppText>
            <Pressable onPress={() => router.push("/sign-in")} style={styles.loginBtn} accessibilityRole="button">
              <AppText size={14} weight="700" color={colors.white}>去登录</AppText>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function Chat({ conversationId, me }: { conversationId: string; me: string }) {
  const insets = useSafeAreaInsets();
  const { blocked } = useBlocks();
  const { profile: myProfile } = useCommunityProfile();
  const { refresh: refreshUnread } = useUnread();
  const { toast, showText, undo } = useToast();
  const sendPress = usePressScale(0.92);

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // 所有已加载的消息（含 pending / failed），升序；群里拉黑过滤在渲染时做。
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [allLoaded, setAllLoaded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [profiles, setProfiles] = useState<Map<string, PublicProfile>>(() => new Map());
  // undefined：关注关系没取到（或群聊），陌生人提示只看发送是否被拒。
  const [peerFollowsMe, setPeerFollowsMe] = useState<boolean | undefined>(undefined);
  // 上一次发送被 stranger_limit 拒绝。
  const [rejected, setRejected] = useState(false);
  const [draft, setDraft] = useState("");
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [reportFor, setReportFor] = useState<ChatMessage | null>(null);

  const mounted = useRef(true);
  const focused = useRef(false);
  const olderBusy = useRef(false);
  const inFlight = useRef(new Set<string>());
  const requestedProfiles = useRef(new Set<string>());
  const messagesRef = useRef<ChatMessage[]>([]);
  const peerRef = useRef<string | null>(null);
  const lastMark = useRef(0);
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  });

  useEffect(() => {
    mounted.current = true;
    const show = Keyboard.addListener(IS_ANDROID ? "keyboardDidShow" : "keyboardWillShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener(IS_ANDROID ? "keyboardDidHide" : "keyboardWillHide", () => setKeyboardUp(false));
    return () => {
      mounted.current = false;
      show.remove();
      hide.remove();
      if (markTimer.current) clearTimeout(markTimer.current);
      markTimer.current = null;
    };
  }, []);

  /** 补资料：每个 id 只请求一次，失败了允许下次再请求。 */
  const loadProfiles = useCallback((ids: (string | null)[]) => {
    const want = [...new Set(ids)].filter((x): x is string => !!x && !requestedProfiles.current.has(x));
    if (!want.length) return;
    for (const x of want) requestedProfiles.current.add(x);
    void settle(getProfiles(getSupabase(), want)).then((r) => {
      if (!r.ok) {
        for (const x of want) requestedProfiles.current.delete(x);
        return;
      }
      if (!mounted.current) return;
      setProfiles((prev) => {
        const next = new Map(prev);
        for (const [k, v] of r.value) next.set(k, v);
        return next;
      });
    });
  }, []);

  const loadPeerStats = useCallback((peer: string) => {
    void settle(getSocialStats(getSupabase(), peer)).then((r) => {
      if (r.ok && mounted.current) setPeerFollowsMe(r.value.followsMe);
    });
  }, []);

  const markNow = useCallback(() => {
    lastMark.current = Date.now();
    return settle(markRead(getSupabase(), conversationId));
  }, [conversationId]);

  /** 收到别人的消息：在本页时节流 markRead，最多每 2 秒 1 次（尾部补一次）。 */
  const markSoon = useCallback(() => {
    if (!focused.current || markTimer.current) return;
    const wait = lastMark.current + MARK_READ_GAP_MS - Date.now();
    if (wait <= 0) {
      void markNow();
      return;
    }
    markTimer.current = setTimeout(() => {
      markTimer.current = null;
      if (focused.current) void markNow();
    }, wait);
  }, [markNow]);

  // 进页 / 离开页各 markRead 一次，读完刷新红点。
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void markNow().then(() => refreshUnread());
      return () => {
        focused.current = false;
        if (markTimer.current) clearTimeout(markTimer.current);
        markTimer.current = null;
        void markNow().then(() => refreshUnread());
      };
    }, [markNow, refreshUnread]),
  );

  // 首屏：会话 + 成员 + 最新一页。首屏 status 已是 loading；重试由 reload() 置 loading。
  useEffect(() => {
    let cancelled = false;
    const client = getSupabase();
    void (async () => {
      const [conv, members, page] = await Promise.all([
        settle(getConversation(client, conversationId)),
        settle(listMembers(client, conversationId)),
        settle(listMessages(client, conversationId)),
      ]);
      if (cancelled) return;
      const failed = !conv.ok ? conv : !members.ok ? members : !page.ok ? page : null;
      if (failed && !failed.ok) {
        setLoad({ status: "error", reason: failed.reason });
        return;
      }
      if (!conv.ok || !members.ok || !page.ok) return;
      setMessages((prev) => mergeMessages(prev, page.value));
      setAllLoaded(page.value.length < MESSAGES_PAGE);
      setLoad({ status: "ready", conv: conv.value, members: members.value });
      loadProfiles([...members.value.map((m) => m.userId), ...page.value.map((m) => m.senderId)]);
      const peer = conv.value.kind === "direct" ? (members.value.find((m) => m.userId !== me)?.userId ?? null) : null;
      peerRef.current = peer;
      if (peer) loadPeerStats(peer);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, me, attempt, loadProfiles, loadPeerStats]);

  // 实时：本会话的新消息并进来；别人的消息节流标已读。
  useEffect(() => {
    return subscribeMessages(getSupabase(), { conversationId }, (m) => {
      setMessages((prev) => mergeMessages(prev, [m]));
      if (m.senderId !== me) {
        markSoon();
        loadProfiles([m.senderId]);
      }
    });
  }, [conversationId, me, markSoon, loadProfiles]);

  // 回到前台：重新拉最新一页并合并（断档时丢掉旧的，允许重新往前翻）。
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void settle(listMessages(getSupabase(), conversationId)).then((r) => {
        if (!r.ok || !mounted.current) return;
        if (mergeLatestPage(messagesRef.current, r.value, MESSAGES_PAGE).reset) setAllLoaded(false);
        setMessages((prev) => mergeLatestPage(prev, r.value, MESSAGES_PAGE).messages);
        loadProfiles(r.value.map((m) => m.senderId));
        if (peerRef.current) loadPeerStats(peerRef.current);
        if (focused.current) void markNow().then(() => refreshUnread());
      });
    });
    return () => sub.remove();
  }, [conversationId, loadProfiles, loadPeerStats, markNow, refreshUnread]);

  const reload = () => {
    setLoad({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  /** 滚到顶：以最早一条已发出的消息为游标加载更早一页。 */
  const loadOlder = async () => {
    if (olderBusy.current || allLoaded || load.status !== "ready") return;
    const oldest = messages.find((m) => !m.pending && !m.failed);
    if (!oldest) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    const r = await settle(listMessages(getSupabase(), conversationId, { createdAt: oldest.createdAt, id: oldest.id }));
    olderBusy.current = false;
    if (!mounted.current) return;
    setLoadingOlder(false);
    if (!r.ok) return;
    setMessages((prev) => mergeMessages(prev, r.value));
    if (r.value.length < MESSAGES_PAGE) setAllLoaded(true);
    loadProfiles(r.value.map((m) => m.senderId));
  };

  const kind = load.status === "ready" ? load.conv.kind : "direct";

  /** 发出 / 重发：pending 行、insert 结果、实时回声共用 msgId，mergeMessages 按 id 去重。 */
  const deliver = async (msgId: string, body: string, retry: boolean) => {
    if (inFlight.current.has(msgId)) return;
    inFlight.current.add(msgId);
    const client = getSupabase();
    try {
      const r = await settle(sendMessage(client, me, conversationId, body, msgId));
      if (!mounted.current) return;
      if (r.ok) {
        setMessages((prev) => mergeMessages(prev, [r.value]));
        setRejected(false);
        return;
      }
      if (retry && r.reason !== "network") {
        // 上一次可能其实发出去了、只是没收到结果，重发会撞主键：看最新一页里有没有这条。
        const latest = await settle(listMessages(client, conversationId));
        if (!mounted.current) return;
        const found = latest.ok ? latest.value.find((m) => m.id === msgId) : undefined;
        if (found) {
          setMessages((prev) => mergeMessages(prev, [found]));
          return;
        }
      }
      // 实时回声可能已经把它换成了真实消息（不再 pending），那就别标失败。
      setMessages((prev) => prev.map((m) => (m.id === msgId && m.pending ? { ...m, pending: false, failed: true } : m)));
      if (r.reason === "stranger_limit") setRejected(true);
      showText(sendFailText(r.reason, kind));
    } finally {
      inFlight.current.delete(msgId);
    }
  };

  const body = validateBody(draft);
  const canSend = load.status === "ready" && body !== null;

  const send = () => {
    if (!canSend || body === null) return;
    const msgId = newMessageId();
    const pending: ChatMessage = {
      id: msgId,
      conversationId,
      senderId: me,
      body,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => mergeMessages(prev, [pending]));
    setDraft("");
    void deliver(msgId, body, false);
  };

  const retrySend = (m: ChatMessage) => {
    if (!m.failed || inFlight.current.has(m.id)) return;
    setMessages((prev) =>
      mergeMessages(prev, [{ ...m, failed: false, pending: true, createdAt: new Date().toISOString() }]),
    );
    void deliver(m.id, m.body, true);
  };

  const onLongPress = (m: ChatMessage) => {
    if (m.senderId === me || m.pending || m.failed) return;
    Haptics.selectionAsync().catch(() => {});
    setMenuFor(m);
  };

  const onReport = async (reason: ReportReason) => {
    const m = reportFor;
    setReportFor(null);
    if (!m) return;
    const r = await settle(report(getSupabase(), me, { messageId: m.id }, reason));
    if (!mounted.current) return;
    showText(r.ok ? "收到，我们会尽快处理" : failMessage(r.reason));
  };

  const conv = load.status === "ready" ? load.conv : null;
  const isGroup = conv?.kind === "group";
  const peerId = load.status === "ready" && !isGroup ? (load.members.find((m) => m.userId !== me)?.userId ?? null) : null;

  const nicknameOf = (senderId: string | null): string => {
    if (senderId === null) return DELETED_USER;
    return profiles.get(senderId)?.nickname || (senderId === me ? myProfile?.nickname : undefined) || FALLBACK_NICKNAME;
  };

  // 群里我拉黑的人的消息不显示；私信不过滤。inverted 列表要倒序，分隔线按升序里的上一条算。
  const rows = useMemo(() => {
    const visible = isGroup ? hideBlocked(messages, blocked, (m) => m.senderId) : messages;
    return visible.map((m, i) => ({ m, separator: needsTimeSeparator(visible[i - 1], m) })).reverse();
  }, [messages, blocked, isGroup]);

  const hint = conv
    ? showStrangerHint({ kind: conv.kind, me, peerId, peerFollowsMe, messages, allLoaded, rejected })
    : false;

  const title = !conv ? "" : isGroup ? (conv.name ?? "群聊") : peerId ? nicknameOf(peerId) : DELETED_USER;
  const now = new Date();

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <IconButton label="返回" onPress={goBack}>
          <BackIcon size={22} color={colors.ink} />
        </IconButton>
        <Pressable
          onPress={() => {
            if (peerId) router.push(`/user/${peerId}`);
          }}
          disabled={!peerId}
          style={IS_ANDROID ? styles.titleAndroid : styles.titleIos}
          accessibilityRole={peerId ? "button" : "header"}
          accessibilityLabel={peerId ? `查看 ${title} 的主页` : title}
        >
          <AppText size={IS_ANDROID ? 20 : 17} weight="700" numberOfLines={1} style={IS_ANDROID ? undefined : { textAlign: "center" }}>
            {title}
          </AppText>
        </Pressable>
        {isGroup ? (
          <IconButton
            label="群设置"
            onPress={() => router.push({ pathname: "/messages/group/[id]", params: { id: conversationId } })}
          >
            <MoreIcon />
          </IconButton>
        ) : (
          <View style={{ width: ICON_BTN }} />
        )}
      </View>

      {load.status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : load.status === "error" ? (
        <View style={styles.center}>
          {load.reason === "unavailable" ? (
            <AppText size={14} color={colors.muted}>这个会话已经看不到了</AppText>
          ) : (
            <>
              <AppText size={14} color={colors.muted}>网络不太好，消息没加载出来</AppText>
              <Pressable onPress={reload} style={styles.retryBtn} accessibilityRole="button">
                <AppText size={14} weight="700">点此重试</AppText>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <FlatList
            inverted
            data={rows}
            keyExtractor={(r) => r.m.id}
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.muted} style={styles.older} /> : undefined}
            renderItem={({ item: { m, separator } }) => {
              const mine = m.senderId === me;
              return (
                <View>
                  {separator ? (
                    <AppText size={12} color={colors.placeholder} style={styles.separator}>
                      {formatChatTime(m.createdAt, now)}
                    </AppText>
                  ) : null}
                  <MessageRow
                    message={m}
                    mine={mine}
                    showSender={isGroup && !mine}
                    nickname={nicknameOf(m.senderId)}
                    avatarUri={m.senderId ? (profiles.get(m.senderId)?.avatarUrl ?? null) : null}
                    onPress={() => retrySend(m)}
                    onLongPress={() => onLongPress(m)}
                  />
                </View>
              );
            }}
          />
          <View style={[styles.bar, { paddingBottom: (keyboardUp ? 0 : insets.bottom) + spacing.sm }]}>
            {hint ? (
              <View style={styles.hint} accessibilityLiveRegion="polite">
                <AppText size={12} color={colors.muted} style={{ textAlign: "center" }}>
                  {STRANGER_HINT}
                </AppText>
              </View>
            ) : null}
            <View style={styles.inputRow}>
              <TextInput
                multiline
                value={draft}
                onChangeText={setDraft}
                maxLength={MAX_BODY}
                placeholder="发消息…"
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="消息内容"
                style={styles.input}
              />
              <Pressable
                onPress={send}
                onPressIn={sendPress.onPressIn}
                onPressOut={sendPress.onPressOut}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="发送"
                accessibilityState={{ disabled: !canSend }}
                hitSlop={4}
              >
                <Animated.View style={[styles.send, !canSend && { backgroundColor: colors.disabled }, sendPress.style]}>
                  <SendIcon />
                </Animated.View>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {menuFor ? (
        <ActionSheet
          actions={[
            {
              label: "举报",
              onPress: () => {
                const m = menuFor;
                setMenuFor(null);
                setReportFor(m);
              },
            },
          ]}
          onCancel={() => setMenuFor(null)}
        />
      ) : null}
      {reportFor ? (
        <ReportSheet title="举报这条消息" onSelect={onReport} onCancel={() => setReportFor(null)} />
      ) : null}
      <Toast toast={toast} bottom={insets.bottom + 96} onUndo={undo} />
    </View>
  );
}

/* ---------------- 一条消息 ---------------- */

function MessageRow({
  message,
  mine,
  showSender,
  nickname,
  avatarUri,
  onPress,
  onLongPress,
}: {
  message: ChatMessage;
  mine: boolean;
  /** 群聊里别人的消息：显示头像和昵称，点头像进主页。 */
  showSender: boolean;
  nickname: string;
  avatarUri: string | null;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const senderId = message.senderId;
  const bubble = (
    <Pressable
      onPress={message.failed ? onPress : undefined}
      onLongPress={mine ? undefined : onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.bubble,
        mine ? styles.bubbleMine : styles.bubbleOther,
        message.pending && { opacity: 0.6 },
        pressed && { opacity: 0.85 },
      ]}
      accessibilityHint={message.failed ? "没发出去，点按重发" : mine ? undefined : "长按可举报"}
    >
      <AppText size={15} color={mine ? colors.white : colors.ink} style={styles.bubbleText}>
        {message.body}
      </AppText>
    </Pressable>
  );

  if (mine) {
    return (
      <View style={[styles.row, styles.rowMine]}>
        {message.failed ? (
          <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel="重发" style={styles.failed}>
            <AppText size={13} weight="800" color={colors.white}>!</AppText>
          </Pressable>
        ) : message.pending ? (
          <ActivityIndicator size="small" color={colors.placeholder} />
        ) : null}
        {bubble}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {showSender ? (
        <Pressable
          onPress={() => {
            if (senderId) router.push(`/user/${senderId}`);
          }}
          disabled={!senderId}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`查看 ${nickname} 的主页`}
        >
          <Avatar uri={avatarUri} name={nickname} size={34} />
        </Pressable>
      ) : null}
      <View style={styles.otherCol}>
        {showSender ? (
          <AppText size={12} color={colors.muted} numberOfLines={1} style={styles.sender}>
            {nickname}
          </AppText>
        ) : null}
        {bubble}
      </View>
    </View>
  );
}

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const press = usePressScale(0.94);
  return (
    <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      <Animated.View style={[styles.iconBtn, press.style]}>{children}</Animated.View>
    </Pressable>
  );
}

function MoreIcon({ color = colors.ink, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={5.5} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={18.5} cy={12} r={1.8} fill={color} />
    </Svg>
  );
}

function SendIcon({ color = colors.white, size = 18 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 19V5m0 0-6 6m6-6 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 12, paddingBottom: 6, minHeight: 52 },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: ICON_BTN / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  titleIos: { flex: 1, alignItems: "center" },
  titleAndroid: { flex: 1, paddingLeft: 4 },
  center: { paddingVertical: spacing.xxl, paddingHorizontal: 20, alignItems: "center", gap: spacing.md },
  loginBtn: { height: 38, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  retryBtn: {
    height: 38,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  older: { marginVertical: spacing.md },
  separator: { alignSelf: "center", marginTop: spacing.md, marginBottom: spacing.xs },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginVertical: 4 },
  rowMine: { justifyContent: "flex-end", alignItems: "center" },
  otherCol: { flexShrink: 1, maxWidth: "78%" },
  sender: { marginBottom: 2, marginLeft: 4 },
  bubble: { maxWidth: "78%", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  bubbleMine: { backgroundColor: colors.ink, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 6, maxWidth: "100%", alignSelf: "flex-start", ...shadow.card },
  bubbleText: { lineHeight: 21 },
  failed: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  bar: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  hint: { marginBottom: spacing.sm },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 21,
    paddingHorizontal: spacing.lg,
    paddingTop: 11,
    paddingBottom: 11,
    backgroundColor: colors.surfaceAlt,
    color: colors.ink,
    fontSize: 15,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
});
