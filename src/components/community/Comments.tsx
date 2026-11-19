import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, { Easing, FadeIn, FadeOut, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { AppText, usePressScale } from "../Common";
import { ConfirmDialog } from "../ConfirmDialog";
import { CloseIcon } from "../Icons";
import { ActionSheet, ReportSheet, type SheetAction } from "./ReportSheet";
import {
  addComment,
  deleteComment,
  getCommunityRecipe,
  getProfiles,
  listComments,
  type PublicProfile,
  report,
  type ReportReason,
  type Result,
} from "../../lib/community/api";
import {
  COMMENT_MAX,
  commentActions,
  commentLength,
  type CommentRow,
  commentTime,
  replyParentId,
  threadComments,
  validateCommentBody,
} from "../../lib/community/logic";
import { failMessage, useCommunityProfile } from "../../lib/community/useCommunityProfile";
import { getSupabase } from "../../lib/supabase";
import { colors, motion, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
/** 资料取不到时的兜底昵称（与默认昵称同前缀，不暴露任何账号信息）。 */
const FALLBACK_NICKNAME = "吃饭的人";
/** 接近上限时才显示计数。 */
const COUNT_FROM = COMMENT_MAX - 50;
const SEND_FAILED = "网络不太好，没发出去";
const ERROR_HOLD_MS = 2200;

const backdropIn = FadeIn.duration(motion.duration.base);
const sheetIn = SlideInDown.duration(motion.duration.slow).easing(Easing.bezier(0.22, 1, 0.36, 1));

/** 网络异常（fetch 直接抛）也折成 Result。 */
const settle = <T,>(p: Promise<Result<T>>): Promise<Result<T>> =>
  p.catch((): Result<T> => ({ ok: false, reason: "network" }));

export type CommentsHandle = {
  /** 打开评论框（发新评论）。游客不跳登录，什么都不做——「评论」按钮只滚到评论区。 */
  focus: () => void;
};

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; rows: CommentRow[] };
type ReplyTarget = { parentId: string; nickname: string };

/**
 * 社区菜详情的评论区：列表（一层回复）+ 底部评论框（键盘弹起时贴在键盘上方）+ 长按操作（删除 / 举报）。
 * 评论框放在 Modal 里，这样即使本组件挂在 ScrollView 内容里也能固定在屏幕底部。
 */
export function Comments({
  ref,
  communityRecipeId,
  recipeAuthorId,
  currentUserId,
  commentCount,
  requireLogin,
  onUnavailable,
  onCountChange,
  toast,
}: {
  ref?: React.Ref<CommentsHandle>;
  communityRecipeId: string;
  /** 菜的作者（内置菜为 null）：作者可删这道菜下的任何评论。 */
  recipeAuthorId: string | null;
  currentUserId: string | null;
  commentCount: number;
  /** 已登录返回 userId；未登录跳登录页并返回 null。 */
  requireLogin: () => string | null;
  /** 菜已不可用（撤回 / 下架）：页面整页变成已下架。 */
  onUnavailable: () => void;
  /** 发出 +1、删除 -1，页面据此更新评论数。 */
  onCountChange: (delta: number) => void;
  toast: (text: string) => void;
}) {
  const { ensure, profile: myProfile } = useCommunityProfile();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [profiles, setProfiles] = useState<Map<string, PublicProfile>>(() => new Map());
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [sending, setSending] = useState(false);
  const [menuFor, setMenuFor] = useState<CommentRow | null>(null);
  const [deleting, setDeleting] = useState<CommentRow | null>(null);
  const [reportFor, setReportFor] = useState<CommentRow | null>(null);
  const sendBusy = useRef(false);
  const opening = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const loadProfiles = useCallback((ids: string[]) => {
    if (!ids.length) return;
    settle(getProfiles(getSupabase(), ids)).then((r) => {
      if (!r.ok || !mounted.current) return;
      setProfiles((prev) => {
        const next = new Map(prev);
        for (const [k, v] of r.value) next.set(k, v);
        return next;
      });
    });
  }, []);

  // 读评论：首屏 status 已是 loading；重试时由 reload() 置 loading，effect 里不同步 setState。
  useEffect(() => {
    let cancelled = false;
    settle(listComments(getSupabase(), communityRecipeId)).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        if (r.reason === "unavailable") onUnavailable();
        else setLoad({ status: "error" });
        return;
      }
      setLoad({ status: "ready", rows: r.value });
      loadProfiles([...new Set(r.value.filter((c) => !c.deleted).map((c) => c.userId))]);
    });
    return () => {
      cancelled = true;
    };
  }, [communityRecipeId, attempt, onUnavailable, loadProfiles]);

  const reload = () => {
    setLoad({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  /** 评论操作说「不可用」时，可能是菜下架了，也可能只是那条评论被隐藏：重读菜确认。 */
  const recipeGone = async (): Promise<boolean> => {
    const again = await settle(getCommunityRecipe(getSupabase(), communityRecipeId));
    if (!again.ok && again.reason === "unavailable") {
      onUnavailable();
      return true;
    }
    return false;
  };

  const nicknameOf = (userId: string): string =>
    profiles.get(userId)?.nickname || (userId === currentUserId ? myProfile?.nickname : undefined) || FALLBACK_NICKNAME;

  /** 打开评论框：要登录、要有昵称（第一次评论时弹起名）。target 为回复对象，不传是新评论。 */
  const openComposer = async (target?: CommentRow) => {
    if (opening.current) return;
    if (!requireLogin()) return;
    opening.current = true;
    try {
      if (!(await ensure()) || !mounted.current) return;
      setReplyTo(target ? { parentId: replyParentId(target), nickname: nicknameOf(target.userId) } : null);
      setComposing(true);
    } finally {
      opening.current = false;
    }
  };

  const openRef = useRef(openComposer);
  useEffect(() => {
    openRef.current = openComposer;
  });
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (currentUserId) void openRef.current();
      },
    }),
    [currentUserId]
  );

  /** 发送：返回 null 成功，否则返回要在评论框里提示的文案（评论框盖在页面 toast 上面）。 */
  const submit = async (): Promise<string | null> => {
    if (sendBusy.current) return null;
    const v = validateCommentBody(draft);
    if (!v.ok) return v.error === "empty" ? "写点什么再发吧" : `最多 ${COMMENT_MAX} 个字`;
    const uid = requireLogin();
    if (!uid) {
      setComposing(false);
      return null;
    }
    sendBusy.current = true;
    setSending(true);
    try {
      const parentId = replyTo?.parentId;
      const r = await settle(addComment(getSupabase(), uid, communityRecipeId, v.value, parentId));
      if (!mounted.current) return null;
      if (r.ok) {
        const row = r.value;
        setLoad((prev) => (prev.status === "ready" ? { status: "ready", rows: [...prev.rows, row] } : prev));
        if (!profiles.has(uid)) loadProfiles([uid]);
        setDraft("");
        setReplyTo(null);
        setComposing(false);
        onCountChange(1);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        return null;
      }
      if (r.reason === "unavailable") {
        if (await recipeGone()) return null;
        if (parentId) {
          // 回复的那条评论被隐藏了：放弃回复对象，刷新列表；草稿保留，可以改成发新评论。
          setReplyTo(null);
          reload();
          return "那条评论已经看不到了";
        }
      }
      return r.reason === "auth" ? failMessage("auth") : SEND_FAILED;
    } finally {
      sendBusy.current = false;
      if (mounted.current) setSending(false);
    }
  };

  const onLongPress = (c: CommentRow) => {
    if (!commentActions(c, currentUserId, recipeAuthorId).length) return;
    Haptics.selectionAsync().catch(() => {});
    setMenuFor(c);
  };

  const menuActions = (c: CommentRow): SheetAction[] =>
    commentActions(c, currentUserId, recipeAuthorId).map((a) =>
      a === "delete"
        ? {
            label: "删除",
            danger: true,
            onPress: () => {
              setMenuFor(null);
              setDeleting(c);
            },
          }
        : {
            label: "举报",
            onPress: () => {
              setMenuFor(null);
              if (requireLogin()) setReportFor(c);
            },
          }
    );

  const onConfirmDelete = async () => {
    const c = deleting;
    setDeleting(null);
    if (!c || !requireLogin()) return;
    const r = await settle(deleteComment(getSupabase(), c.id));
    if (!mounted.current) return;
    if (r.ok) {
      setLoad((prev) =>
        prev.status === "ready"
          ? { status: "ready", rows: prev.rows.map((x) => (x.id === c.id ? { ...x, deleted: true, body: "" } : x)) }
          : prev
      );
      onCountChange(-1);
      toast("已删除");
      return;
    }
    if (r.reason === "unavailable") {
      if (await recipeGone()) return;
      reload();
      return toast("这条评论已经看不到了");
    }
    toast(r.reason === "network" ? "网络不太好，没删掉" : failMessage(r.reason));
  };

  const onReport = async (reason: ReportReason) => {
    const c = reportFor;
    setReportFor(null);
    const uid = requireLogin();
    if (!c || !uid) return;
    const r = await settle(report(getSupabase(), uid, { commentId: c.id }, reason));
    if (!mounted.current) return;
    if (r.ok) return toast("收到，我们会尽快处理");
    if (r.reason === "unavailable" && (await recipeGone())) return;
    toast(failMessage(r.reason));
  };

  const threads = load.status === "ready" ? threadComments(load.rows) : [];
  const now = new Date();

  return (
    <View>
      <AppText size={20} weight="800" style={{ letterSpacing: -0.3 }}>
        {commentCount > 0 ? `评论 ${commentCount}` : "评论"}
      </AppText>

      <Pressable
        onPress={() => void openComposer()}
        style={({ pressed }) => [styles.entry, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="写评论"
      >
        <AppText size={14} color={colors.placeholder} numberOfLines={1} style={{ flex: 1 }}>
          {draft.trim() ? draft.trim() : "说点什么…"}
        </AppText>
      </Pressable>

      {load.status === "loading" ? (
        <ActivityIndicator color={colors.muted} style={styles.state} />
      ) : load.status === "error" ? (
        <View style={styles.stateBox}>
          <AppText size={14} color={colors.muted}>评论没加载出来</AppText>
          <Pressable onPress={reload} style={styles.retry} accessibilityRole="button" accessibilityLabel="重新加载评论">
            <AppText size={13} weight="700" color={colors.ink}>重试</AppText>
          </Pressable>
        </View>
      ) : threads.length === 0 ? (
        <AppText size={14} color={colors.muted} style={styles.state}>
          还没有评论，来说两句
        </AppText>
      ) : (
        threads.map(({ comment, replies }) => (
          <View key={comment.id} style={styles.thread}>
            {comment.deleted ? (
              <View style={styles.deletedRow}>
                <AppText size={14} color={colors.placeholder}>该评论已删除</AppText>
              </View>
            ) : (
              <CommentItem
                comment={comment}
                profile={profiles.get(comment.userId)}
                nickname={nicknameOf(comment.userId)}
                time={commentTime(comment.createdAt, now)}
                onReply={() => void openComposer(comment)}
                onLongPress={() => onLongPress(comment)}
              />
            )}
            {replies.length ? (
              <View style={styles.replies}>
                {replies.map((reply) => (
                  <CommentItem
                    key={reply.id}
                    small
                    comment={reply}
                    profile={profiles.get(reply.userId)}
                    nickname={nicknameOf(reply.userId)}
                    time={commentTime(reply.createdAt, now)}
                    onReply={() => void openComposer(reply)}
                    onLongPress={() => onLongPress(reply)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))
      )}

      {composing ? (
        <Composer
          draft={draft}
          onChange={setDraft}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          sending={sending}
          onSubmit={submit}
          onClose={() => setComposing(false)}
        />
      ) : null}

      {menuFor ? <ActionSheet actions={menuActions(menuFor)} onCancel={() => setMenuFor(null)} /> : null}
      {reportFor ? (
        <ReportSheet title="举报这条评论" onSelect={onReport} onCancel={() => setReportFor(null)} />
      ) : null}
      {deleting ? (
        // ConfirmDialog 是绝对定位的蒙层；本组件在 ScrollView 里，套一层 Modal 才能盖住整屏。
        <Modal transparent animationType="none" visible onRequestClose={() => setDeleting(null)}>
          <ConfirmDialog
            title="删除这条评论？"
            message={replyCount(load, deleting) > 0 ? "删除后，下面的回复还在，这里会显示「该评论已删除」" : "删除后不能恢复"}
            confirmLabel="删除"
            destructive
            onCancel={() => setDeleting(null)}
            onConfirm={() => void onConfirmDelete()}
          />
        </Modal>
      ) : null}
    </View>
  );
}

function replyCount(load: LoadState, c: CommentRow): number {
  if (load.status !== "ready" || c.parentId) return 0;
  return load.rows.filter((r) => r.parentId === c.id && !r.deleted).length;
}

/* ---------------- 一条评论 ---------------- */

function CommentItem({
  comment,
  profile,
  nickname,
  time,
  small = false,
  onReply,
  onLongPress,
}: {
  comment: CommentRow;
  profile: PublicProfile | undefined;
  nickname: string;
  time: string;
  small?: boolean;
  onReply: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.85 }]}
      accessibilityHint="长按可删除或举报"
    >
      <Avatar uri={profile?.avatarUrl ?? null} name={nickname} size={small ? 26 : 34} />
      <View style={{ flex: 1 }}>
        <AppText size={13} weight="700" color={colors.muted} numberOfLines={1}>
          {nickname}
        </AppText>
        <AppText size={15} style={styles.body}>
          {comment.body}
        </AppText>
        <View style={styles.meta}>
          <AppText size={12} color={colors.placeholder}>{time}</AppText>
          <Pressable onPress={onReply} hitSlop={10} accessibilityRole="button" accessibilityLabel={`回复 ${nickname}`}>
            <AppText size={12} weight="700" color={colors.muted}>回复</AppText>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function Avatar({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri && !failed) {
    return <Image alt={name} source={{ uri }} style={[styles.avatar, box]} onError={() => setFailed(true)} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, box]}>
      <AppText size={Math.round(size * 0.42)} weight="800" color={colors.accentText}>
        {Array.from(name)[0] ?? ""}
      </AppText>
    </View>
  );
}

/* ---------------- 底部评论框 ---------------- */

function Composer({
  draft,
  onChange,
  replyTo,
  onCancelReply,
  sending,
  onSubmit,
  onClose,
}: {
  draft: string;
  onChange: (text: string) => void;
  replyTo: ReplyTarget | null;
  onCancelReply: () => void;
  sending: boolean;
  onSubmit: () => Promise<string | null>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const press = usePressScale(0.92);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const length = commentLength(draft);
  const tooLong = length > COMMENT_MAX;
  const canSend = !sending && length > 0 && !tooLong;

  useEffect(() => {
    const show = Keyboard.addListener(IS_ANDROID ? "keyboardDidShow" : "keyboardWillShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener(IS_ANDROID ? "keyboardDidHide" : "keyboardWillHide", () => setKeyboardUp(false));
    alive.current = true;
    return () => {
      alive.current = false;
      show.remove();
      hide.remove();
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = null;
    };
  }, []);

  const flash = (text: string) => {
    if (!alive.current) return;
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(text);
    errorTimer.current = setTimeout(() => setError(null), ERROR_HOLD_MS);
  };

  // 发送中不让收起：失败提示只显示在评论框里，收起了就看不到了。
  const close = () => {
    if (!sending) onClose();
  };

  const send = async () => {
    const message = await onSubmit();
    if (message) flash(message);
  };

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={IS_ANDROID ? "height" : "padding"}>
        <Animated.View entering={backdropIn} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="收起评论框" />
          {error ? (
            <Animated.View
              entering={FadeIn.duration(motion.duration.fast)}
              exiting={FadeOut.duration(motion.duration.fast)}
              style={styles.flash}
              accessibilityLiveRegion="polite"
            >
              <AppText size={14} weight="700" color={colors.white}>{error}</AppText>
            </Animated.View>
          ) : null}
          <Animated.View
            entering={sheetIn}
            style={[styles.bar, { paddingBottom: (keyboardUp ? 0 : insets.bottom) + spacing.md }]}
          >
            {replyTo ? (
              <View style={styles.replyRow}>
                <AppText size={13} weight="700" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>
                  回复 @{replyTo.nickname}
                </AppText>
                <Pressable onPress={onCancelReply} hitSlop={10} accessibilityRole="button" accessibilityLabel="取消回复">
                  <CloseIcon size={16} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.inputRow}>
              <TextInput
                autoFocus
                multiline
                value={draft}
                onChangeText={onChange}
                placeholder={replyTo ? `回复 @${replyTo.nickname}` : "说点什么…"}
                placeholderTextColor={colors.placeholder}
                accessibilityLabel={replyTo ? `回复 ${replyTo.nickname}` : "评论内容"}
                style={styles.input}
              />
              <Pressable
                onPress={() => void send()}
                onPressIn={press.onPressIn}
                onPressOut={press.onPressOut}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="发送"
                accessibilityState={{ disabled: !canSend, busy: sending }}
                hitSlop={4}
              >
                <Animated.View style={[styles.send, !canSend && { backgroundColor: colors.disabled }, press.style]}>
                  {sending ? <ActivityIndicator color={colors.white} size="small" /> : <SendIcon />}
                </Animated.View>
              </Pressable>
            </View>
            {length > COUNT_FROM ? (
              <AppText size={12} weight="700" color={tooLong ? colors.danger : colors.muted} style={styles.count}>
                {`${Math.min(length, COMMENT_MAX)}/${COMMENT_MAX}`}
                {tooLong ? `，超出 ${length - COMMENT_MAX} 字` : ""}
              </AppText>
            ) : null}
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
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
  entry: {
    marginTop: spacing.md,
    minHeight: 44,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    flexDirection: "row",
    alignItems: "center",
  },
  state: { marginTop: spacing.xl, alignSelf: "center" },
  stateBox: { marginTop: spacing.xl, alignItems: "center", gap: spacing.sm },
  retry: {
    height: 34,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    justifyContent: "center",
  },
  thread: { marginTop: spacing.lg },
  deletedRow: { paddingVertical: spacing.sm },
  replies: { marginLeft: 44, marginTop: 2 },
  item: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  avatar: { backgroundColor: colors.surfaceAlt },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft },
  body: { marginTop: 2, lineHeight: 22 },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: 4 },

  backdrop: { flex: 1, backgroundColor: "rgba(23,31,46,0.25)", justifyContent: "flex-end" },
  flash: {
    alignSelf: "center",
    marginBottom: spacing.md,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    ...shadow.floating,
  },
  bar: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    ...shadow.floating,
  },
  replyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
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
  count: { marginTop: 6, textAlign: "right", fontVariant: ["tabular-nums"] },
});
