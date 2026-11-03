import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable as RNPressable } from "react-native";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/Common";
import { FoodArt } from "../../components/FoodArt";
import { CloseIcon, HeartIcon, StarIcon } from "../../components/Icons";
import {
  cancelNotice,
  notificationsSupported,
  openNotificationSettings,
  type NotifyPermission,
  readNotifyPermission,
  requestNotifyPermission,
  scheduleStepDone,
} from "../../lib/cookNotify";
import { CookSession, clearCookSession, loadCookSession, saveCookSession } from "../../lib/cookSession";
import { useStore } from "../../state/store";
import { colors, radius, spacing } from "../../theme";

const DEEP = "#2E4636";
const FLOAT = "#3C5743";
const DIM = colors.onDeepBody;
const SUB = colors.onDeepSub;
const HINT = colors.onDeepHint;
const LABEL = colors.onDeepLabel;
const TIP = colors.onDeepTipBody;

const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${`${minutes}`.padStart(2, "0")}:${`${rest}`.padStart(2, "0")}`;
};

export default function CookScreen() {
  const { id, step: stepParam, resume: resumeParam } = useLocalSearchParams<{
    id: string;
    step?: string;
    resume?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { favorites, toggleFavorite, setMeal, selectedDate, ratings, rateRecipe, logCooked, findRecipe } = useStore();
  const recipe = findRecipe(id);
  useKeepAwake();

  const initialStep = Number(stepParam ?? 0);
  const [step, setStep] = useState(Number.isFinite(initialStep) && initialStep > 0 ? initialStep : 0);
  const [left, setLeft] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [elapsedTotal, setElapsedTotal] = useState(0);
  const [showExit, setShowExit] = useState(false);
  const [perm, setPerm] = useState<NotifyPermission | null>(null);
  const [showEnableRow, setShowEnableRow] = useState(false);
  const elapsedBase = useRef(0);
  const runStart = useRef<number | null>(Date.now());
  const remainingHold = useRef(0);
  const deadline = useRef<number | null>(null);
  const noticeId = useRef<string | null>(null);
  const [resume, setResume] = useState<CookSession | null>(null);
  const [resumeReady, setResumeReady] = useState(false);
  const skipStepReset = useRef(false);
  const liveRef = useRef({ step: 0, left: 0, paused: false, elapsed: 0, finished: false, ready: false });

  // 烹饪页目前只排文本；每步的图这一轮先不插进来，读的时候直接把 text 取出来。
  const steps = useMemo(() => recipe?.steps.map((item) => item.text) ?? [], [recipe]);
  const total = steps.length;
  const stepSeconds = useMemo(() => {
    if (!recipe) return 0;
    const perStep = recipe.stepMinutes?.[step];
    if (perStep) return perStep * 60;
    return Math.max(1, Math.round(recipe.minutes / Math.max(1, total))) * 60;
  }, [recipe, step, total]);

  const commitRun = useCallback(() => {
    if (runStart.current !== null) {
      elapsedBase.current += Date.now() - runStart.current;
      runStart.current = null;
    }
  }, []);

  useEffect(() => {
    if (skipStepReset.current) {
      skipStepReset.current = false;
      return;
    }
    setLeft(stepSeconds);
    remainingHold.current = stepSeconds * 1000;
    if (runStart.current === null) {
      runStart.current = Date.now();
    }
    deadline.current = Date.now() + remainingHold.current;
  }, [step, stepSeconds]);

  useEffect(() => {
    if (!recipe) {
      setResumeReady(true);
      return;
    }
    let cancelled = false;
    loadCookSession(recipe.id).then((saved) => {
      if (cancelled) return;
      if (saved) {
        const remaining = saved.deadlineAt
          ? Math.max(0, Math.round((saved.deadlineAt - Date.now()) / 1000))
          : Math.max(0, saved.remaining);
        skipStepReset.current = true;
        remainingHold.current = remaining * 1000;
        setStep(saved.step);
        setLeft(remaining);
        setElapsedTotal(saved.elapsedTotal);
        if (resumeParam === "1") {
          // 从首页「继续上次烹饪」进来，直接接着走表，不再二次确认。
          runStart.current = Date.now();
          deadline.current = Date.now() + remaining * 1000;
          setPaused(false);
        } else {
          setPaused(true);
          setResume(saved);
        }
      }
      setResumeReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [recipe, resumeParam]);

  useEffect(() => {
    liveRef.current = { step, left, paused, elapsed: elapsedTotal, finished, ready: resumeReady };
  }, [step, left, paused, elapsedTotal, finished, resumeReady]);

  // 会话落盘：暂停/切步/退到后台/每 5 秒各写一次，重开 App 才能接着做。
  useEffect(() => {
    if (!recipe || !resumeReady) return;
    const persist = () => {
      const live = liveRef.current;
      if (live.finished || !live.ready) return;
      const untouched = live.step === 0 && live.elapsed === 0;
      if (untouched) return;
      saveCookSession({
        recipeId: recipe.id,
        recipeName: recipe.name,
        step: live.step,
        remaining: live.left,
        deadlineAt: live.paused ? null : deadline.current,
        elapsedTotal: live.elapsed,
        savedAt: Date.now(),
      });
    };
    persist();
    const timer = setInterval(persist, 5000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") persist();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [recipe, resumeReady, paused, step, finished]);

  useEffect(() => {
    if (!notificationsSupported) return;
    let cancelled = false;
    const read = () => {
      readNotifyPermission().then((next) => {
        if (!cancelled) setPerm(next);
      });
    };
    read();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (perm === "granted") setShowEnableRow(false);
  }, [perm]);

  useEffect(() => {
    const clear = () => {
      const id = noticeId.current;
      noticeId.current = null;
      cancelNotice(id);
    };
    if (!recipe || paused || finished || perm !== "granted") return clear;
    const remaining = deadline.current ? deadline.current - Date.now() : stepSeconds * 1000;
    if (remaining <= 1500) return clear;
    let active = true;
    scheduleStepDone({
      recipeId: recipe.id,
      recipeName: recipe.name,
      step,
      text: steps[step] ?? "",
      seconds: remaining / 1000,
    }).then((id) => {
      if (!active) {
        cancelNotice(id);
        return;
      }
      noticeId.current = id;
    });
    return () => {
      active = false;
      clear();
    };
  }, [recipe, paused, finished, step, stepSeconds, total, steps, perm]);

  useEffect(() => {
    if (paused || finished) return;
    const tick = () => {
      if (deadline.current === null) return;
      const now = Date.now();
      const remaining = deadline.current - now;
      setLeft(Math.max(0, Math.ceil(remaining / 1000)));
      if (runStart.current !== null) {
        setElapsedTotal(Math.floor((elapsedBase.current + now - runStart.current) / 1000));
      }
      if (remaining <= 0) {
        const finishedAt = deadline.current;
        commitRun();
        remainingHold.current = 0;
        deadline.current = finishedAt;
        setElapsedTotal(Math.floor(elapsedBase.current / 1000));
        setPaused(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [paused, finished, commitRun]);

  const togglePaused = () => {
    if (perm === "undetermined") setShowEnableRow(true);
    if (paused) {
      remainingHold.current = Math.max(0, left * 1000);
      runStart.current = Date.now();
      deadline.current = Date.now() + remainingHold.current;
      setPaused(false);
    } else {
      commitRun();
      remainingHold.current = deadline.current ? Math.max(0, deadline.current - Date.now()) : 0;
      deadline.current = null;
      setPaused(true);
    }
  };

  const goNext = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setShowEnableRow((current) => current || perm === "undetermined");
    if (step + 1 >= total) {
      commitRun();
      remainingHold.current = deadline.current ? Math.max(0, deadline.current - Date.now()) : 0;
      deadline.current = null;
      setPaused(true);
      logCooked(recipe?.id ?? "");
      clearCookSession();
      setFinished(true);
      return;
    }
    setStep((value) => value + 1);
    setPaused(false);
  }, [step, total, logCooked, recipe?.id, commitRun, perm]);

  const goPrev = useCallback(() => {
    if (step === 0) return;
    setStep((value) => value - 1);
    setPaused(false);
  }, [step]);

  const favorited = recipe ? favorites.includes(recipe.id) : false;
  const myRating = recipe ? ratings[recipe.id] ?? 0 : 0;
  const done = left === 0;
  const progress = useMemo(() => (total === 0 ? 0 : (step + 1) / total), [step, total]);

  const resumeContinue = () => {
    if (!resume) return;
    const ms = Math.max(0, resume.remaining) * 1000;
    remainingHold.current = ms;
    runStart.current = Date.now();
    deadline.current = Date.now() + ms;
    setPaused(false);
    setResume(null);
  };

  const resumeFinish = () => {
    if (!resume) return;
    logCooked(resume.recipeId);
    clearCookSession();
    setResume(null);
    router.back();
  };

  if (!recipe) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 40, paddingHorizontal: 24 }]}>
        <AppText size={16} weight="700" color={colors.cream}>菜谱不存在</AppText>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <AppText size={14} color={colors.cream}>返回</AppText>
        </Pressable>
      </View>
    );
  }

  const tone = (hex: string, alpha: string) => hex + alpha;

  // 三支分开写：不可用 ≠ 用户关过通知，别把责任推给用户。
  const notifyUnavailable = (!notificationsSupported || perm === "unavailable") && !finished;
  const notifyDenied = notificationsSupported && perm === "denied" && !finished;
  const notifyAsking = notificationsSupported && perm === "undetermined" && showEnableRow && !finished;

  const notifySlot =
    notifyUnavailable || notifyDenied || notifyAsking ? (
      <View style={styles.notifyRow}>
        <AppText size={10} color={SUB} style={{ flex: 1 }}>
          {notifyUnavailable
            ? "到点只在 App 里提示，离开后会错过"
            : notifyDenied
              ? "提醒已关闭，到点只在前台提示"
              : "离开 App 也能收到到点提醒"}
        </AppText>
        {notifyUnavailable ? null : notifyDenied ? (
          <Pressable onPress={openNotificationSettings} hitSlop={8} accessibilityLabel="去系统设置打开通知">
            <AppText size={11} weight="600" color={colors.orangeOnDeep}>去设置</AppText>
          </Pressable>
        ) : (
          <Pressable
            onPress={async () => {
              const granted = await requestNotifyPermission();
              setPerm(granted ? "granted" : await readNotifyPermission());
              setShowEnableRow(false);
            }}
            hitSlop={8}
            accessibilityLabel="开启到点提醒"
          >
            <AppText size={11} weight="600" color={colors.orangeOnDeep}>开启</AppText>
          </Pressable>
        )}
      </View>
    ) : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (!finished && (!paused || elapsedTotal > 0) ? setShowExit(true) : router.back())}
          hitSlop={10}
          style={styles.closeBtn}
          accessibilityLabel="退出烹饪"
        >
          <CloseIcon size={16} color={DIM} />
        </Pressable>
        <AppText size={12} weight="600" color={tone("#FFFFFF", "D9")}>
          第 {step + 1} 步 / 共 {total} 步
        </AppText>
        <View style={[styles.timerPill, done && { borderColor: colors.orange }]}>
          <AppText size={11} weight="600" color={done ? colors.orangeOnDeep : DIM} style={{ fontVariant: ["tabular-nums"] }}>
            {formatTime(left)}
          </AppText>
        </View>
      </View>

      <View style={styles.progressRow}>
        {steps.map((_, index) => (
          <View
            key={index}
            style={[
              styles.progressSegment,
              { backgroundColor: index < step ? colors.orange : index === step ? "#E08C6E" : "rgba(255,255,255,0.16)" },
            ]}
          />
        ))}
      </View>

      {notifySlot}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        {recipe.heat ? (
          <View style={styles.heatChip}>
            <AppText size={10} weight="600" color={DIM}>{recipe.heat}</AppText>
          </View>
        ) : null}

        <View style={styles.artHolder}>
          <FoodArt kind={recipe.art} size={190} label={recipe.name} />
        </View>

        {done ? (
          <View style={styles.doneTag}>
            <AppText size={10} weight="700" color={colors.orangeOnDeep}>计时完成</AppText>
          </View>
        ) : null}

        <AppText size={21} weight="800" color={colors.cream} style={{ marginTop: done ? spacing.sm : spacing.xl, lineHeight: 30 }}>
          {steps[step]}
        </AppText>
        <AppText size={11} color={SUB} style={{ marginTop: 6 }}>
          {recipe.name} · 这一步大约 {Math.max(1, Math.round(stepSeconds / 60))} 分钟
        </AppText>

        {recipe.tips?.[step] ? (
          <View style={styles.tipCard}>
            <AppText size={9} weight="600" color={LABEL} style={{ letterSpacing: 0.5 }}>
              小提示
            </AppText>
            <AppText size={11} color={TIP} style={{ marginTop: 4, lineHeight: 18 }}>
              {recipe.tips[step]}
            </AppText>
          </View>
        ) : null}

        <View style={styles.dotsRow}>
          {steps.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                { backgroundColor: index === step ? colors.orange : index < step ? "#7E9076" : "rgba(255,255,255,0.18)" },
              ]}
            />
          ))}
        </View>
      </ScrollView>

      <View style={styles.controls}>
        <Pressable
          onPress={goPrev}
          disabled={step === 0}
          style={[styles.circle, step === 0 && { opacity: 0.3 }]}
          accessibilityLabel="上一步"
        >
          <AppText size={18} weight="600" color={DIM}>‹</AppText>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            togglePaused();
          }}
          style={styles.playButton}
          accessibilityLabel={paused ? "继续计时" : "暂停计时"}
        >
          {paused ? (
            <View style={styles.playTriangle} />
          ) : (
            <View style={{ flexDirection: "row", gap: 6 }}>
              <View style={styles.pauseBar} />
              <View style={styles.pauseBar} />
            </View>
          )}
        </Pressable>
        <Pressable onPress={goNext} style={styles.circle} accessibilityLabel={step + 1 >= total ? "完成" : "下一步"}>
          <AppText size={18} weight="600" color={DIM}>›</AppText>
        </Pressable>
      </View>

      <AppText size={10} color={HINT} style={{ textAlign: "center", marginBottom: spacing.md }}>
        {paused ? "计时已暂停 · 点中间按钮继续" : "暂停计时 · 左右按钮切换步骤"}
      </AppText>

      <View
        style={styles.finishSlot}
        pointerEvents={step + 1 >= total ? "auto" : "none"}
        accessibilityElementsHidden={step + 1 < total}
        importantForAccessibility={step + 1 >= total ? "auto" : "no-hide-descendants"}
      >
        <Pressable
          style={[styles.finishButton, step + 1 < total && styles.finishButtonHidden]}
          onPress={goNext}
          accessibilityLabel="完成这道菜"
        >
          <AppText size={14} weight="700" color={colors.cream}>完成这道菜</AppText>
        </Pressable>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <AppText size={11} color={LABEL}>
          已完成 {step} 步，还剩 {Math.max(0, total - step - 1)} 步
        </AppText>
        <Pressable onPress={() => setShowAll(true)} hitSlop={8} accessibilityLabel="查看全部步骤">
          <AppText size={11} weight="600" color={colors.orangeOnDeep}>查看全部步骤 →</AppText>
        </Pressable>
      </View>

      <Modal visible={Boolean(resume)} transparent animationType="slide" onRequestClose={resumeFinish}>
        <View style={styles.sheetBackdrop}>
          <View />
          <View style={[styles.resumeCard, { marginBottom: insets.bottom + spacing.md }]}>
            <AppText size={10} weight="600" color={LABEL} style={{ letterSpacing: 0.5 }}>
              继续上次烹饪
            </AppText>
            <AppText size={15} weight="800" color={colors.cream} style={{ marginTop: 6 }}>
              {resume?.recipeName} · 第 {(resume?.step ?? 0) + 1} 步
            </AppText>
            <AppText size={11} color={SUB} style={{ marginTop: 4 }}>
              还剩 {formatTime(resume?.remaining ?? 0)} · 已用时 {formatTime(resume?.elapsedTotal ?? 0)}
            </AppText>
            <Pressable style={styles.resumePrimary} onPress={resumeContinue}>
              <AppText size={13} weight="700" color={colors.cream}>继续烹饪</AppText>
            </Pressable>
            <Pressable style={styles.resumeGhost} onPress={resumeFinish} accessibilityLabel="结束并记录这次烹饪">
              <AppText size={12} weight="600" color={colors.cream}>结束并记录</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showAll} transparent animationType="slide" onRequestClose={() => setShowAll(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAll(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <AppText size={16} weight="800" color={colors.cream} style={{ marginBottom: spacing.md }}>
              全部 {total} 步
            </AppText>
            <ScrollView style={{ maxHeight: 360 }}>
              {steps.map((text, index) => (
                <Pressable
                  key={index}
                  onPress={() => {
                    setStep(index);
                    setPaused(false);
                    setShowAll(false);
                  }}
                  style={[styles.sheetRow, index === step && { backgroundColor: "rgba(215,101,67,0.14)" }]}
                >
                  <AppText size={11} weight="700" color={index === step ? colors.orangeOnDeep : HINT} style={{ width: 22 }}>
                    {index + 1}
                  </AppText>
                  <AppText size={12} color={index === step ? colors.cream : "#B9C7B2"} style={{ flex: 1, lineHeight: 19 }}>
                    {text}
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showExit} transparent animationType="fade" onRequestClose={() => setShowExit(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.exitCard}>
            <AppText size={16} weight="800">先不做了吗？</AppText>
            <AppText size={12} color={colors.muted} style={{ marginTop: 6, lineHeight: 19 }}>
              当前在第 {step + 1} 步，已用时 {formatTime(elapsedTotal)}。
            </AppText>
            <Pressable style={styles.exitPrimary} onPress={() => setShowExit(false)}>
              <AppText size={13} weight="700" color={colors.cream}>继续烹饪</AppText>
            </Pressable>
            <Pressable
              style={styles.exitGhost}
              onPress={() => {
                setShowExit(false);
                router.back();
              }}
            >
              <AppText size={13} weight="600" color={colors.green}>结束并保存进度</AppText>
            </Pressable>
            <Pressable
              style={{ marginTop: spacing.md, paddingVertical: spacing.sm }}
              onPress={() => {
                setShowExit(false);
                clearCookSession();
                router.back();
              }}
            >
              <AppText size={12} color={colors.muted}>放弃本次烹饪</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={finished} transparent animationType="fade" onRequestClose={() => setFinished(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.doneBadge}>
              <AppText size={24} color={colors.green}>✓</AppText>
            </View>
            <AppText size={20} weight="800" style={{ marginTop: spacing.md }}>
              开饭啦
            </AppText>
            <AppText size={12} color={colors.muted} style={{ marginTop: 6, textAlign: "center", lineHeight: 20 }}>
              {recipe.name} 完成，总用时 {formatTime(elapsedTotal)}。
              {"\n"}要把它记进今天的菜单吗？
            </AppText>

            <View style={styles.ratingRow}>
              <AppText size={12} color={colors.muted}>给这道菜打分</AppText>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    rateRecipe(recipe.id, star);
                  }}
                  hitSlop={4}
                  accessibilityLabel={`评 ${star} 星`}
                >
                  <StarIcon size={22} filled={star <= myRating} color={star <= myRating ? colors.orange : "#D8D3C0"} />
                </Pressable>
              ))}
            </View>

            <Pressable onPress={() => toggleFavorite(recipe.id)} style={styles.metaRow}>
              <HeartIcon size={16} filled={favorited} color={favorited ? colors.orange : colors.green} />
              <AppText size={13} color={colors.green} weight="600">
                {favorited ? "已收藏" : "收藏这道菜"}
              </AppText>
            </Pressable>

            <Pressable
              style={styles.primary}
              onPress={() => {
                setMeal(selectedDate, "午餐", recipe.id);
                setFinished(false);
                router.back();
              }}
            >
              <AppText size={14} weight="700" color={colors.cream}>记入今日午餐</AppText>
            </Pressable>
            <Pressable
              onPress={() => {
                setFinished(false);
                router.back();
              }}
              style={styles.textOnly}
            >
              <AppText size={13} color={colors.muted}>稍后再说</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DEEP, paddingHorizontal: spacing.xl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  timerPill: {
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 60,
  },
  progressRow: { flexDirection: "row", gap: 6, marginTop: spacing.lg },
  progressSegment: { flex: 1, height: 3, borderRadius: 2 },
  heatChip: {
    alignSelf: "flex-start",
    marginTop: spacing.lg,
    backgroundColor: FLOAT,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  artHolder: {
    alignSelf: "center",
    width: 232,
    height: 232,
    borderRadius: 116,
    backgroundColor: "#F0EBDD",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  doneTag: {
    alignSelf: "flex-start",
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.orange,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  tipCard: {
    marginTop: spacing.lg,
    backgroundColor: FLOAT,
    borderRadius: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  dotsRow: { flexDirection: "row", gap: 6, justifyContent: "center", marginTop: spacing.lg },
  dot: { width: 5, height: 5, borderRadius: 3 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxl,
    marginTop: spacing.md,
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  pauseBar: { width: 5, height: 22, borderRadius: 2, backgroundColor: colors.cream },
  playTriangle: {
    width: 0,
    height: 0,
    marginLeft: 5,
    borderTopWidth: 11,
    borderBottomWidth: 11,
    borderLeftWidth: 18,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: colors.cream,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
    paddingTop: spacing.md,
  },
  finishSlot: {
    height: 48 + spacing.md,
    justifyContent: "flex-end",
  },
  finishButtonHidden: {
    opacity: 0,
  },
  finishButton: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.orangeText,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: DEEP,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.24)",
    marginBottom: spacing.lg,
  },
  sheetRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    marginBottom: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20,26,18,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: "100%",
    alignItems: "center",
  },
  exitCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: "100%",
  },
  exitPrimary: {
    marginTop: spacing.lg,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  exitGhost: {
    marginTop: spacing.sm,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  resumeCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: DEEP,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  resumePrimary: {
    marginTop: spacing.md,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.orangeText,
    alignItems: "center",
    justifyContent: "center",
  },
  resumeGhost: { marginTop: 2, paddingVertical: 10, alignItems: "center" },
  notifyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
  },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.lg },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.md, paddingVertical: spacing.sm },
  primary: {
    marginTop: spacing.md,
    width: "100%",
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.orangeText,
    alignItems: "center",
    justifyContent: "center",
  },
  textOnly: { marginTop: spacing.sm, paddingVertical: spacing.sm },
});
