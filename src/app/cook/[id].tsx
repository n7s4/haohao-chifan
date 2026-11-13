import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  ZoomIn,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/Common";
import {
  BackIcon,
  ChevronRightIcon,
  CloseIcon,
  FlameIcon,
  HeartIcon,
  PlayIcon,
  StarIcon,
} from "../../components/Icons";
import { SteamPot } from "../../components/SteamPot";
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
import { colors, motion, radius, shadow, spacing } from "../../theme";

const DEEP = colors.deep;
const FLOAT = colors.deepRaised;
const DIM = colors.onDeepBody;
const SUB = colors.onDeepSub;
const HINT = colors.onDeepHint;
const LABEL = colors.onDeepLabel;
const GLASS = "rgba(255,255,255,0.08)";

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
  const { favorites, toggleFavorite, setMeal, selectedDate, ratings, rateRecipe, logCooked, cookedThisWeek, findRecipe } =
    useStore();
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
  /** 每到点一次 +1，蒸汽锅据此跳锅盖。 */
  const [dingKey, setDingKey] = useState(0);
  /** 切步方向：1 往后、-1 往前，决定步骤文字从哪边滑入。 */
  const [dir, setDir] = useState(1);
  const elapsedBase = useRef(0);
  // 挂载时由切步 effect 写入起点，不在渲染里读时钟。
  const runStart = useRef<number | null>(null);
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
    if (!recipe) return;
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
        setDingKey((n) => n + 1);
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
    setDir(1);
    setStep((value) => value + 1);
    setPaused(false);
  }, [step, total, logCooked, recipe?.id, commitRun, perm]);

  const goPrev = useCallback(() => {
    if (step === 0) return;
    Haptics.selectionAsync().catch(() => {});
    setDir(-1);
    setStep((value) => value - 1);
    setPaused(false);
  }, [step]);

  const favorited = recipe ? favorites.includes(recipe.id) : false;
  const myRating = recipe ? ratings[recipe.id] ?? 0 : 0;
  const done = left === 0;
  const remainingRatio = stepSeconds > 0 ? left / stepSeconds : 0;
  const isLast = step + 1 >= total;

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
        <AppText size={16} weight="700" color={colors.canvas}>菜谱不存在</AppText>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <AppText size={14} color={colors.canvas}>返回</AppText>
        </Pressable>
      </View>
    );
  }

  // 三支分开写：不可用 ≠ 用户关过通知，别把责任推给用户。
  const notifyUnavailable = (!notificationsSupported || perm === "unavailable") && !finished;
  const notifyDenied = notificationsSupported && perm === "denied" && !finished;
  const notifyAsking = notificationsSupported && perm === "undetermined" && showEnableRow && !finished;

  const notifySlot =
    notifyUnavailable || notifyDenied || notifyAsking ? (
      <View style={styles.notifyRow}>
        <AppText size={12} color={SUB} style={{ flex: 1 }}>
          {notifyUnavailable
            ? "到点只在 App 里提示，离开后会错过"
            : notifyDenied
              ? "提醒已关闭，到点只在前台提示"
              : "离开 App 也能收到到点提醒"}
        </AppText>
        {notifyUnavailable ? null : notifyDenied ? (
          <Pressable onPress={openNotificationSettings} hitSlop={8} accessibilityLabel="去系统设置打开通知">
            <AppText size={13} weight="700" color={colors.sun}>去设置</AppText>
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
            <AppText size={13} weight="700" color={colors.sun}>开启</AppText>
          </Pressable>
        )}
      </View>
    ) : null;

  const hint = paused
    ? done
      ? isLast
        ? "最后一步到点啦，点「完成这道菜」"
        : "这一步到点啦，点 › 进入下一步"
      : "计时已暂停 · 锅在打盹"
    : "锅在忙，到点会叫你";
  const minutesUsed = Math.max(1, Math.round(elapsedTotal / 60));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (!finished && (!paused || elapsedTotal > 0) ? setShowExit(true) : router.back())}
          hitSlop={6}
          style={styles.glassBtn}
          accessibilityLabel="退出烹饪"
        >
          <CloseIcon size={18} color={colors.onDeepTitle} />
        </Pressable>
        <View style={styles.titleBox}>
          <AppText size={16} weight="800" color={colors.onDeepTitle} numberOfLines={1}>
            {recipe.name}
          </AppText>
          <AppText size={12} weight="600" color={SUB} style={{ marginTop: 2 }}>
            {finished ? `${total} 步全部完成` : `第 ${step + 1} / ${total} 步`}
          </AppText>
        </View>
        {recipe.heat ? (
          <View style={styles.heatChip}>
            <FlameIcon size={14} color={colors.sun} />
            <AppText size={12} weight="700" color={colors.sun}>
              {recipe.heat}
            </AppText>
          </View>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {!finished ? (
        <Animated.View exiting={FadeOutDown.duration(250)} style={styles.bars} accessibilityElementsHidden>
          {steps.map((_, index) => {
            const fill = index < step ? 1 : index === step ? 1 - remainingRatio : 0;
            return (
              <View key={index} style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%` }]} />
              </View>
            );
          })}
        </Animated.View>
      ) : null}

      {notifySlot}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!finished}
      >
        <PotStage finished={finished}>
          <SteamPot
            mode={finished ? "finished" : paused ? "paused" : "running"}
            progress={remainingRatio}
            dingKey={dingKey}
          />
        </PotStage>

        {!finished ? (
          <Animated.View exiting={FadeOutDown.duration(250)}>
            <View style={styles.clock}>
              <AppText
                size={56}
                weight="800"
                color={done ? colors.sun : colors.onDeepTitle}
                style={styles.clockText}
                maxFontSizeMultiplier={1}
              >
                {formatTime(left)}
              </AppText>
              <AppText size={13} color={SUB} style={{ marginTop: 6 }}>
                {hint}
              </AppText>
            </View>

            <Animated.View
              key={step}
              entering={(dir > 0 ? FadeInRight : FadeInLeft).duration(420)}
              style={styles.stepBlock}
            >
              <AppText size={13} weight="700" color={colors.sun}>
                第 {step + 1} 步 · 约 {Math.max(1, Math.round(stepSeconds / 60))} 分钟
              </AppText>
              <AppText size={21} weight="700" color={colors.onDeepTitle} style={{ marginTop: 6, lineHeight: 32 }}>
                {steps[step]}
              </AppText>
            </Animated.View>

            {recipe.tips?.[step] ? (
              <Animated.View key={`tip-${step}`} entering={FadeIn.duration(420).delay(120)} style={styles.tipCard}>
                <AppText size={13} weight="800" color={colors.onDeepTitle}>
                  小提示
                </AppText>
                <AppText size={13} color={SUB} style={{ flex: 1, lineHeight: 20 }}>
                  {recipe.tips[step]}
                </AppText>
              </Animated.View>
            ) : null}

            <View style={styles.footer}>
              <AppText size={12} color={LABEL}>
                已完成 {step} 步，还剩 {Math.max(0, total - step - 1)} 步
              </AppText>
              <Pressable onPress={() => setShowAll(true)} hitSlop={10} accessibilityLabel="查看全部步骤">
                <AppText size={12} weight="700" color={colors.sun}>
                  查看全部步骤 →
                </AppText>
              </Pressable>
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>

      {!finished ? (
        <Animated.View
          exiting={FadeOutDown.duration(250)}
          style={[styles.controls, { bottom: insets.bottom + spacing.xl }]}
        >
          <Squish onPress={goPrev} disabled={step === 0} style={[styles.sideBtn, step === 0 && { opacity: 0.3 }]} label="上一步">
            <BackIcon size={24} color={colors.onDeepTitle} />
          </Squish>
          <MainButton
            paused={paused}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              togglePaused();
            }}
          />
          {isLast ? (
            <Squish onPress={goNext} style={styles.finishBtn} label="完成这道菜">
              <AppText size={16} weight="800" color={colors.white}>
                完成这道菜
              </AppText>
            </Squish>
          ) : (
            <Squish
              onPress={goNext}
              style={[styles.sideBtn, done && paused && styles.sideBtnCall]}
              label="下一步"
            >
              <ChevronRightIcon size={24} color={done && paused ? colors.ink : colors.onDeepTitle} />
            </Squish>
          )}
        </Animated.View>
      ) : (
        <View style={[styles.doneLayer, { paddingBottom: insets.bottom + spacing.lg }]} pointerEvents="box-none">
          <Animated.View entering={ZoomIn.springify().damping(11).delay(550)}>
            <AppText size={48} weight="800" color={colors.onDeepTitle} style={{ letterSpacing: -1 }} maxFontSizeMultiplier={1}>
              开饭啦！
            </AppText>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(850).duration(600)} style={styles.doneCard}>
            <View style={styles.statRow}>
              <Stat value={`${minutesUsed}′`} label="这次用时" />
              <Stat value={`${cookedThisWeek}`} label="本周第几道" />
              <Stat value={`${total}`} label="步全部完成" />
            </View>

            <View style={styles.ratingRow}>
              <AppText size={13} color={colors.muted}>
                给这道菜打分
              </AppText>
              <View style={{ flexDirection: "row", gap: 4 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    key={star}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      rateRecipe(recipe.id, star);
                    }}
                    hitSlop={4}
                    style={styles.starHit}
                    accessibilityLabel={`评 ${star} 星`}
                  >
                    <StarIcon size={24} filled={star <= myRating} color={star <= myRating ? colors.sun : colors.disabled} />
                  </Pressable>
                ))}
              </View>
            </View>

            <Pressable onPress={() => toggleFavorite(recipe.id)} style={styles.favRow} accessibilityLabel={favorited ? "取消收藏" : "收藏这道菜"}>
              <HeartIcon size={18} filled={favorited} color={favorited ? colors.accent : colors.ink} />
              <AppText size={14} weight="700" color={colors.ink}>
                {favorited ? "已收藏" : "收藏这道菜"}
              </AppText>
            </Pressable>

            <Pressable
              style={styles.darkBtn}
              onPress={() => {
                setMeal(selectedDate, "午餐", recipe.id);
                setFinished(false);
                router.back();
              }}
            >
              <AppText size={15} weight="700" color={colors.white}>
                记入今日午餐
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => {
                setFinished(false);
                router.back();
              }}
              style={styles.textBtn}
            >
              <AppText size={14} color={colors.muted}>
                稍后再说
              </AppText>
            </Pressable>
          </Animated.View>
        </View>
      )}

      <Modal visible={Boolean(resume)} transparent animationType="slide" onRequestClose={resumeFinish}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.resumeCard, { marginBottom: insets.bottom + spacing.md }]}>
            <AppText size={12} weight="700" color={colors.sun}>
              继续上次烹饪
            </AppText>
            <AppText size={18} weight="800" color={colors.onDeepTitle} style={{ marginTop: 6 }}>
              {resume?.recipeName} · 第 {(resume?.step ?? 0) + 1} 步
            </AppText>
            <AppText size={13} color={SUB} style={{ marginTop: 4 }}>
              还剩 {formatTime(resume?.remaining ?? 0)} · 已用时 {formatTime(resume?.elapsedTotal ?? 0)}
            </AppText>
            <Pressable style={styles.sunBtn} onPress={resumeContinue}>
              <PlayIcon size={18} color={colors.ink} />
              <AppText size={15} weight="800" color={colors.ink}>
                继续烹饪
              </AppText>
            </Pressable>
            <Pressable style={styles.textBtn} onPress={resumeFinish} accessibilityLabel="结束并记录这次烹饪">
              <AppText size={14} weight="600" color={colors.onDeepTitle}>
                结束并记录
              </AppText>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showAll} transparent animationType="slide" onRequestClose={() => setShowAll(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowAll(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <AppText size={18} weight="800" color={colors.onDeepTitle} style={{ marginBottom: spacing.md }}>
              全部 {total} 步
            </AppText>
            <ScrollView style={{ maxHeight: 380 }}>
              {steps.map((text, index) => {
                const current = index === step;
                const past = index < step;
                return (
                  <Pressable
                    key={index}
                    onPress={() => {
                      setDir(index >= step ? 1 : -1);
                      setStep(index);
                      setPaused(false);
                      setShowAll(false);
                    }}
                    style={[styles.sheetRow, current && styles.sheetRowOn]}
                  >
                    <View style={[styles.stepNum, past && { backgroundColor: colors.leaf }, current && { backgroundColor: colors.sun }]}>
                      <AppText size={12} weight="800" color={past || current ? colors.ink : HINT}>
                        {index + 1}
                      </AppText>
                    </View>
                    <AppText
                      size={14}
                      color={current ? colors.onDeepTitle : past ? HINT : DIM}
                      style={{ flex: 1, lineHeight: 21 }}
                    >
                      {text}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showExit} transparent animationType="fade" onRequestClose={() => setShowExit(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.exitCard}>
            <AppText size={19} weight="800">
              先不做了吗？
            </AppText>
            <AppText size={14} color={colors.muted} style={{ marginTop: 6, lineHeight: 21 }}>
              第 {step + 1} 步 · 已用时 {formatTime(elapsedTotal)}，进度会自动保存。
            </AppText>
            <Pressable style={styles.darkBtn} onPress={() => setShowExit(false)}>
              <AppText size={15} weight="700" color={colors.white}>
                继续烹饪
              </AppText>
            </Pressable>
            <Pressable
              style={styles.softBtn}
              onPress={() => {
                setShowExit(false);
                router.back();
              }}
            >
              <AppText size={15} weight="700" color={colors.ink}>
                结束并保存进度
              </AppText>
            </Pressable>
            <Pressable
              style={styles.textBtn}
              onPress={() => {
                setShowExit(false);
                clearCookSession();
                router.back();
              }}
            >
              <AppText size={14} color={colors.danger}>
                放弃本次烹饪
              </AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** 完成时锅往下沉、放大一点，靠近「开饭啦！」。 */
function PotStage({ finished, children }: { finished: boolean; children: React.ReactNode }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withSpring(finished ? 1 : 0, motion.springSoft));
  }, [finished, t]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * 40 }, { scale: 1 + t.value * 0.06 }],
  }));
  return <Animated.View style={[styles.stage, style]}>{children}</Animated.View>;
}

/** 按下缩小、松手弹回的按钮。 */
function Squish({
  onPress,
  disabled,
  style,
  label,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  style?: React.ComponentProps<typeof View>["style"];
  label: string;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => scale.set(withSpring(0.88, motion.spring))}
      onPressOut={() => scale.set(withSpring(1, motion.spring))}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}

/** 中间的大按钮：计时中是圆角方块 + 暂停，暂停时变成圆 + 播放。 */
function MainButton({ paused, onPress }: { paused: boolean; onPress: () => void }) {
  const round = useSharedValue(paused ? 1 : 0);
  useEffect(() => {
    round.set(withSpring(paused ? 1 : 0, motion.springSoft));
  }, [paused, round]);
  const shape = useAnimatedStyle(() => ({ borderRadius: 30 + round.value * 12 }));
  return (
    <Squish onPress={onPress} label={paused ? "继续计时" : "暂停计时"}>
      <Animated.View style={[styles.mainBtn, shape]}>
        {paused ? (
          <View style={{ marginLeft: 4 }}>
            <PlayIcon size={34} color={colors.ink} />
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: 7 }}>
            <View style={styles.pauseBar} />
            <View style={styles.pauseBar} />
          </View>
        )}
      </Animated.View>
    </Squish>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <AppText size={24} weight="800" color={colors.ink} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </AppText>
      <AppText size={12} color={colors.muted} style={{ marginTop: 2 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DEEP },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: 48,
  },
  glassBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: GLASS,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBox: { flex: 1, alignItems: "center" },
  heatChip: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: GLASS,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  bars: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  bar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.deepLine, overflow: "hidden" },
  barFill: { height: 5, borderRadius: 3, backgroundColor: colors.sun },
  notifyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    paddingHorizontal: 14,
    minHeight: 36,
    borderRadius: 12,
    backgroundColor: GLASS,
  },
  stage: { alignSelf: "center", marginTop: spacing.sm },
  clock: { alignItems: "center", marginTop: -6 },
  clockText: { fontVariant: ["tabular-nums"], letterSpacing: -1, lineHeight: 62 },
  stepBlock: { marginTop: spacing.lg, marginHorizontal: spacing.xl, minHeight: 110 },
  tipCard: {
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.sm,
    marginHorizontal: spacing.xl,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
    minHeight: 44,
  },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxl,
  },
  sideBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: GLASS,
    alignItems: "center",
    justifyContent: "center",
  },
  sideBtnCall: { backgroundColor: colors.sun },
  mainBtn: {
    width: 84,
    height: 84,
    backgroundColor: colors.sun,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.sun,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  pauseBar: { width: 8, height: 28, borderRadius: 3, backgroundColor: colors.ink },
  finishBtn: {
    height: 64,
    paddingHorizontal: 22,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  doneLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  doneCard: {
    alignSelf: "stretch",
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 26,
    padding: 18,
    ...shadow.floating,
  },
  statRow: { flexDirection: "row", marginBottom: spacing.lg },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 6,
    minHeight: 48,
  },
  starHit: { width: 34, height: 44, alignItems: "center", justifyContent: "center" },
  favRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, marginTop: 4 },
  darkBtn: {
    marginTop: spacing.md,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  softBtn: {
    marginTop: spacing.sm,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  sunBtn: {
    marginTop: spacing.lg,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.sun,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  textBtn: { marginTop: 4, minHeight: 44, alignItems: "center", justifyContent: "center" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: FLOAT,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.24)",
    marginBottom: spacing.lg,
  },
  sheetRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 14,
    marginBottom: 2,
  },
  sheetRowOn: { backgroundColor: "rgba(255,200,58,0.14)" },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: GLASS,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(8,24,17,0.6)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  exitCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    width: "100%",
  },
  resumeCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: FLOAT,
  },
});
