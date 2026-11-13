/**
 * 「链接 / 截图导入」面板：粘贴一段笔记文字、或选几张截图，交给服务端解析成草稿。
 *
 * 改版后它不再是底部弹层，而是新建菜谱页分段控件下的第一个面板（设计稿 create.html 的 #import）。
 * 这里不直接入库：拿回来的只是草稿，回填到「手动填写」面板由用户逐项核对，
 * 所以这个组件只负责收集输入、显示进度/失败、把 draft 交出去。
 */
import React from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppText } from "./Common";
import { CheckIcon, CloseIcon, SparkleIcon } from "./Icons";
import { colors, motion, radius, spacing } from "../theme";
import {
  checkTranscript,
  fetchXhsNote,
  importRecipeMixed,
  ImportedDraft,
  ImportError,
  linkPlaceholder,
  TRANSCRIPT_PREFIX,
} from "../lib/importRecipe";
import { PickedPhoto, pickScreenshots } from "../lib/pickPhoto";
import { ImageIcon, LinkIcon } from "./create/CreateIcons";
import { PressScale } from "./create/Controls";
import { Field, IS_ANDROID, Label } from "./create/Field";

const STEPS = ["读取内容", "提取图文 / 字幕", "AI 整理用量", "生成菜谱"];
const STEP_TICK_MS = 3200;
const MAX_IMAGES = 9;
const GRID_GAP = 10;

type Phase = "input" | "working" | "error";
/** 视频配音转写的状态：只在读过一条视频笔记后出现。 */
type TranscriptPhase = "idle" | "running" | "done" | "failed" | "skipped";

const TRANSCRIPT_POLL_MS = 3000;
/** 百炼说「通常数分钟内」；5 分钟还没好就别让用户干等了。 */
const TRANSCRIPT_MAX_MS = 5 * 60 * 1000;
const MAX_TEXT = 8000;
/** 小红书图床校验 Referer，不带的话预览是一片灰。 */
const XHS_IMAGE_HEADERS = { Referer: "https://www.xiaohongshu.com/" };

const isRemote = (uri: string) => /^https?:\/\//i.test(uri);

function appendBlock(current: string, block: string): string {
  const base = current.trim();
  return (base ? `${base}\n\n${block}` : block).slice(0, MAX_TEXT);
}

/** 解析按钮里的星星：解析中匀速转圈，停下时弹回原位。 */
function SpinningSparkle({ spinning }: { spinning: boolean }) {
  const deg = useSharedValue(0);
  React.useEffect(() => {
    if (spinning) {
      deg.set(0);
      deg.set(withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1));
    } else {
      cancelAnimation(deg);
      deg.set(withSpring(0, motion.spring));
    }
  }, [spinning, deg]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${deg.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <SparkleIcon size={18} color={colors.sun} />
    </Animated.View>
  );
}

/** 进度圆点：进行中是缺一角的阳光黄圆环在转，完成是叶子绿实心 + 对勾弹出来。 */
function StageDot({ state }: { state: "todo" | "doing" | "ok" }) {
  const deg = useSharedValue(0);
  const doing = state === "doing";
  React.useEffect(() => {
    if (doing) deg.set(withRepeat(withTiming(360, { duration: 800, easing: Easing.linear }), -1));
    else cancelAnimation(deg);
  }, [doing, deg]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${deg.value}deg` }] }));

  if (state === "ok") {
    return (
      <Animated.View entering={ZoomIn.springify().damping(12)} style={[styles.dot, styles.dotOk]}>
        <CheckIcon size={14} color={colors.white} />
      </Animated.View>
    );
  }
  return <Animated.View style={[styles.dot, doing && styles.dotDoing, doing && spin]} />;
}

export function ImportRecipePane({
  onDraft,
  onBusyChange,
}: {
  /** 草稿里的 coverUri / steps[].imageUris 指向这里的图片，调用方负责落成菜谱图片。 */
  onDraft: (draft: ImportedDraft) => void;
  onManual?: () => void;
  /** 解析中调用方要锁住「手动填写」切换，免得迟到的草稿覆盖刚填的内容。 */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [images, setImages] = React.useState<PickedPhoto[]>([]);
  const [phase, setPhase] = React.useState<Phase>("input");
  const [stepIndex, setStepIndex] = React.useState(0);
  const [message, setMessage] = React.useState("");
  const [shake, setShake] = React.useState(0);
  const [gridW, setGridW] = React.useState(0);
  // 401 是唯一不该给「重试」的一档：token 已经废了，点多少次都一样。
  const [needsLogin, setNeedsLogin] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // 取消之后迟到的结果不能再回填表单，只用一个递增的号码牌判断。
  const runId = React.useRef(0);

  // —— 小红书链接 ——
  const [link, setLink] = React.useState("");
  const [linkBusy, setLinkBusy] = React.useState(false);
  const [linkMessage, setLinkMessage] = React.useState("");
  const [linkShake, setLinkShake] = React.useState(0);
  // 抓取时已经扣过一次配额；带着它解析不再扣。30 分钟后服务端自己判过期，照常扣。
  const [importTicket, setImportTicket] = React.useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = React.useState<string | null>(null);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [transcript, setTranscript] = React.useState<TranscriptPhase>("idle");
  const linkRun = React.useRef(0);
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  React.useEffect(
    () => () => {
      stopTimer();
      stopPolling();
      linkRun.current += 1;
    },
    []
  );

  /** 轮询配音转写：拿到就追加进文字框，失败只提示、不影响已经回填的正文和图片。 */
  const pollTranscript = (ticket: string, id: number, startedAt: number) => {
    pollTimer.current = setTimeout(async () => {
      if (linkRun.current !== id) return;
      if (Date.now() - startedAt > TRANSCRIPT_MAX_MS) {
        setTranscript("failed");
        return;
      }
      try {
        const state = await checkTranscript(ticket);
        if (linkRun.current !== id) return;
        if (state.status === "running") return pollTranscript(ticket, id, startedAt);
        if (state.status === "done") {
          setText((current) => appendBlock(current, `${TRANSCRIPT_PREFIX}\n${state.text}`));
          setTranscript("done");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          return;
        }
        setTranscript("failed");
      } catch (problem) {
        if (linkRun.current !== id) return;
        // 断网一下别判死，接着等；过期或没开通才停。
        if (problem instanceof ImportError && (problem.code === "offline" || problem.code === "timeout")) {
          return pollTranscript(ticket, id, startedAt);
        }
        setTranscript("failed");
      }
    }, TRANSCRIPT_POLL_MS);
  };

  const readLink = async () => {
    if (linkBusy || working) return;
    if (!link.trim()) {
      setLinkShake((n) => n + 1);
      setLinkMessage("先粘贴小红书的分享链接");
      return;
    }
    const id = ++linkRun.current;
    stopPolling();
    setLinkBusy(true);
    setLinkMessage("");
    setTranscript("idle");
    try {
      const result = await fetchXhsNote(link);
      if (linkRun.current !== id) return;
      const { note } = result;
      if (note.text) setText((current) => appendBlock(current, note.text));
      if (note.imageUrls.length) {
        setImages((current) => {
          const known = new Set(current.map((item) => item.uri));
          const fresh = note.imageUrls.filter((uri) => !known.has(uri)).map((uri) => ({ uri, width: 0, height: 0 }));
          return [...current, ...fresh].slice(0, MAX_IMAGES);
        });
      }
      setImportTicket(result.importTicket);
      setSourceUrl(note.sourceUrl);
      setVideoUrl(note.videoUrl ?? null);
      setLink("");
      setMessage("");
      if (result.transcript && "ticket" in result.transcript) {
        setTranscript("running");
        pollTranscript(result.transcript.ticket, id, Date.now());
      } else if (note.isVideo) {
        setTranscript("skipped");
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (problem) {
      if (linkRun.current !== id) return;
      setLinkMessage(problem instanceof Error && problem.message ? problem.message : "读取失败，稍后再试");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      if (linkRun.current === id) setLinkBusy(false);
    }
  };

  const working = phase === "working";
  const canSubmit = images.length > 0 || text.trim().length >= 10;

  const start = async () => {
    if (working) return;
    if (!canSubmit) {
      // 设计稿：按钮常亮，点了再告诉用户缺什么，比一个灰按钮更好懂。
      setShake((n) => n + 1);
      setMessage(text.trim() ? "内容太短，至少要有菜名和做法" : "先贴文字或加截图");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    const id = ++runId.current;
    setPhase("working");
    onBusyChange?.(true);
    setStepIndex(0);
    setMessage("");
    setNeedsLogin(false);
    stopTimer();
    timer.current = setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
    }, STEP_TICK_MS);
    try {
      const draft = await importRecipeMixed({
        text,
        uris: images.map((item) => item.uri),
        importTicket,
        sourceUrl,
      });
      if (runId.current !== id) return;
      stopTimer();
      stopPolling();
      linkRun.current += 1;
      setPhase("input");
      onBusyChange?.(false);
      setText("");
      setImages([]);
      setImportTicket(null);
      setSourceUrl(null);
      setVideoUrl(null);
      setTranscript("idle");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onDraft(videoUrl ? { ...draft, videoUrl } : draft);
    } catch (problem) {
      if (runId.current !== id) return;
      stopTimer();
      setPhase("error");
      onBusyChange?.(false);
      setNeedsLogin(problem instanceof ImportError && problem.code === "session_expired");
      setMessage(problem instanceof Error && problem.message ? problem.message : "解析失败，换段内容再试");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  };

  const pickImages = async () => {
    const room = MAX_IMAGES - images.length;
    if (room <= 0 || working) return;
    try {
      const picked = await pickScreenshots(room);
      if (!picked.length) return;
      setImages((current) => [...current, ...picked].slice(0, MAX_IMAGES));
      setMessage("");
    } catch (problem) {
      setPhase("error");
      setMessage(problem instanceof Error ? problem.message : "选图失败，再试一次");
    }
  };

  const removeImage = (uri: string) => {
    setImages((current) => current.filter((item) => item.uri !== uri));
  };

  const cancel = () => {
    runId.current += 1;
    stopTimer();
    setPhase("input");
    onBusyChange?.(false);
    setStepIndex(0);
    setNeedsLogin(false);
  };

  const goSignIn = () => {
    router.push("/sign-in");
  };

  const tileW = gridW ? Math.floor((gridW - GRID_GAP * 2) / 3) : 0;
  const tile = { width: tileW, height: Math.round((tileW * 4) / 3) };
  // 第一行不满三格时，用淡掉的空格补齐，和设计稿一样能看出「还能放几张」。
  const filler = Math.max(0, 3 - images.length - (images.length < MAX_IMAGES ? 1 : 0));

  const buttonLabel = needsLogin ? "去登录" : working ? "解析中…" : phase === "error" ? "重新解析" : "开始解析";

  return (
    <View>
      <Animated.View entering={FadeInDown.duration(motion.duration.slow)} style={styles.aiHead}>
        <SparkleIcon size={28} color={colors.sunText} />
        <View style={{ flex: 1 }}>
          <AppText size={16} weight="800">看到好菜，丢进来就行</AppText>
          <AppText size={13} color={colors.sunText} style={{ marginTop: 3, lineHeight: 19 }}>
            贴链接、文字或截图，整理成菜谱
          </AppText>
        </View>
      </Animated.View>

      <Label>小红书链接</Label>
      <View style={styles.linkRow}>
        <Field
          value={link}
          onChangeText={(value) => {
            setLink(value);
            if (linkMessage) setLinkMessage("");
          }}
          placeholder="粘贴小红书分享口令或链接"
          editable={!linkBusy && !working}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={readLink}
          error={Boolean(linkMessage)}
          shake={linkShake}
          icon={<LinkIcon size={20} color={colors.placeholder} />}
          style={{ flex: 1 }}
          accessibilityLabel="小红书链接"
        />
        <PressScale
          onPress={readLink}
          disabled={linkBusy || working}
          style={[styles.linkButton, (linkBusy || working) && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityState={{ busy: linkBusy }}
          accessibilityLabel={linkBusy ? "正在读取链接" : "读取链接"}
        >
          <AppText size={15} weight="700" color={colors.white}>{linkBusy ? "读取中…" : "读取"}</AppText>
        </PressScale>
      </View>
      {linkMessage ? (
        <Animated.View entering={FadeIn.duration(motion.duration.base)}>
          <AppText size={13} color={colors.danger} style={{ marginTop: spacing.sm, lineHeight: 19 }}>
            {linkMessage}
          </AppText>
        </Animated.View>
      ) : null}
      {transcript !== "idle" ? (
        <Animated.View entering={FadeIn.duration(motion.duration.base)} style={styles.transcriptRow}>
          {transcript === "running" ? <StageDot state="doing" /> : transcript === "done" ? <StageDot state="ok" /> : null}
          <AppText size={13} color={transcript === "failed" || transcript === "skipped" ? colors.muted : colors.ink} style={{ flex: 1, lineHeight: 19 }}>
            {transcript === "running"
              ? "正在识别视频配音，约 1–3 分钟"
              : transcript === "done"
                ? "配音已加到文字里"
                : transcript === "skipped"
                  ? "配音识别失败，可手动补做法"
                  : "没识别出配音，可手动补做法"}
          </AppText>
        </Animated.View>
      ) : null}

      <Label style={{ marginTop: spacing.xl }}>笔记文字</Label>
      <Field
        value={text}
        onChangeText={(value) => {
          setText(value);
          if (phase === "error" || message) setMessage("");
        }}
        placeholder={linkPlaceholder}
        multiline
        maxLength={8000}
        editable={!working}
        error={Boolean(message) && !canSubmit && phase !== "error"}
        shake={shake}
        inputStyle={styles.textarea}
        accessibilityLabel="笔记文字"
      />

      <Label hint={`最多 ${MAX_IMAGES} 张`} style={{ marginTop: spacing.xl }}>
        截图
      </Label>
      <View style={styles.shots} onLayout={(event) => setGridW(event.nativeEvent.layout.width)}>
        {tileW
          ? images.map((item, index) => (
              <Animated.View
                key={item.uri}
                entering={ZoomIn.springify().damping(12).stiffness(200)}
                exiting={FadeOut.duration(motion.duration.fast)}
                style={[styles.shot, tile]}
              >
                <Image
                  source={isRemote(item.uri) ? { uri: item.uri, headers: XHS_IMAGE_HEADERS } : { uri: item.uri }}
                  style={styles.shotImage} resizeMode="cover" alt={`第 ${index + 1} 张截图`} />
                <View style={styles.shotIndex}>
                  <AppText size={11} weight="800" color={colors.white}>{index + 1}</AppText>
                </View>
                <Pressable
                  onPress={() => removeImage(item.uri)}
                  disabled={working}
                  hitSlop={6}
                  style={styles.shotRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`删除第 ${index + 1} 张截图`}
                >
                  <CloseIcon size={14} color={colors.white} />
                </Pressable>
              </Animated.View>
            ))
          : null}
        {tileW && images.length < MAX_IMAGES ? (
          <PressScale
            onPress={pickImages}
            disabled={working}
            style={[styles.shot, styles.shotAdd, tile]}
            accessibilityRole="button"
            accessibilityLabel="添加截图"
          >
            <ImageIcon size={22} color={colors.placeholder} />
            <AppText size={12.5} weight="600" color={colors.placeholder} style={{ marginTop: 4 }}>
              添加截图
            </AppText>
            {images.length ? (
              <AppText size={11} color={colors.placeholder} style={{ marginTop: 2 }}>
                {images.length}/{MAX_IMAGES}
              </AppText>
            ) : null}
          </PressScale>
        ) : null}
        {tileW
          ? Array.from({ length: filler }, (_, index) => (
              <View key={`filler-${index}`} style={[styles.shot, styles.shotAdd, styles.shotFiller, tile]} />
            ))
          : null}
      </View>

      {message ? (
        <Animated.View entering={FadeIn.duration(motion.duration.base)}>
          <AppText size={13} color={colors.danger} style={{ marginTop: spacing.md, lineHeight: 19 }}>
            {message}
          </AppText>
          {phase === "error" && images.length > 0 && !needsLogin ? (
            <AppText size={12} color={colors.muted} style={{ marginTop: 4, lineHeight: 18 }}>
              可以先只用文字解析
            </AppText>
          ) : null}
        </Animated.View>
      ) : null}

      {working ? (
        <Animated.View entering={FadeInDown.duration(motion.duration.base)} exiting={FadeOut.duration(motion.duration.fast)} style={styles.stages}>
          {STEPS.map((label, index) => {
            const state = index < stepIndex ? "ok" : index === stepIndex ? "doing" : "todo";
            return (
              <View key={label} style={styles.stageRow}>
                <StageDot state={state} />
                <AppText size={15} weight="600" color={state === "todo" ? colors.placeholder : colors.ink}>
                  {label}
                </AppText>
              </View>
            );
          })}
          <AppText size={12} color={colors.muted} style={{ marginTop: 4, lineHeight: 18 }}>
            大约 20 秒
          </AppText>
          {transcript === "running" ? (
            <AppText size={12} color={colors.sunText} style={{ marginTop: 4, lineHeight: 18 }}>
              配音还没识别完，本次不含配音
            </AppText>
          ) : null}
        </Animated.View>
      ) : null}

      <PressScale
        onPress={needsLogin ? goSignIn : start}
        style={[styles.primary, working && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityState={{ busy: working }}
        accessibilityLabel={needsLogin ? "去登录" : working ? "正在解析" : "开始解析"}
      >
        {needsLogin ? null : <SpinningSparkle spinning={working} />}
        <AppText size={16} weight="700" color={colors.white}>{buttonLabel}</AppText>
      </PressScale>

      {working ? (
        <Pressable onPress={cancel} style={styles.ghost} accessibilityRole="button" accessibilityLabel="取消解析">
          <AppText size={15} weight="600" color={colors.muted}>取消解析</AppText>
        </Pressable>
      ) : null}

      <AppText size={11} color={colors.placeholder} style={{ marginTop: spacing.sm, lineHeight: 17, textAlign: "center" }}>
        抖音笔记请用截图导入
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  aiHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: IS_ANDROID ? 20 : radius.lg,
    backgroundColor: colors.sunSoft,
    marginBottom: 18,
  },
  textarea: { minHeight: 96, maxHeight: 220 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  linkButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: IS_ANDROID ? radius.pill : 14,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  transcriptRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  shots: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  shot: { borderRadius: 16, overflow: "hidden" },
  shotImage: { width: "100%", height: "100%", backgroundColor: colors.surfaceAlt },
  shotAdd: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  shotFiller: { opacity: 0.4 },
  shotIndex: {
    position: "absolute",
    left: 6,
    bottom: 6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  shotRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  stages: { marginTop: spacing.xl },
  stageRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDoing: { borderColor: colors.sun, borderTopColor: "transparent" },
  dotOk: { backgroundColor: colors.leaf, borderColor: colors.leaf },
  primary: {
    marginTop: 22,
    minHeight: 52,
    borderRadius: IS_ANDROID ? radius.pill : 16,
    backgroundColor: colors.ink,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ghost: { minHeight: 52, marginTop: 4, alignItems: "center", justifyContent: "center" },
});
