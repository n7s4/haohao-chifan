import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  ZoomIn,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/Common";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DraggableMeal } from "../../components/DraggableMeal";
import { FoodArt } from "../../components/FoodArt";
import {
  BackIcon,
  BasketIcon,
  ChevronRightIcon,
  ClockIcon,
  GripIcon,
  HeartIcon,
  PlusIcon,
  SparkleIcon,
  SwapIcon,
  TrashIcon,
} from "../../components/Icons";
import { Toast, useToast } from "../../components/Toast";
import { MealSlot, mealSlots, recipeCalories, recipeMinutes } from "../../data/recipes";
import { PlanMap, addDays, parseKey, startOfWeek, toKey, useStore } from "../../state/store";
import { colors, motion, radius, shadow, spacing } from "../../theme";

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const weekdayOf = (key: string) => `周${weekdayLabels[(parseKey(key).getDay() + 6) % 7]}`;

/** 插图底色按餐次轮换，和发现页瀑布流同一套四色。 */
const slotTint: Record<MealSlot, string> = {
  早餐: colors.sunSoft,
  午餐: colors.leafSoft,
  晚餐: colors.accentSoft,
};

const STRIP_GAP = 6;
const ROW_GAP = 12;
const DAY_DROP_PAD = 6;
const AI_THINK_MS = 650;

export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const {
    plan,
    weekDays,
    shiftWeek,
    selectedDate,
    setSelectedDate,
    applyPlan,
    planThreeDays,
    shoppingItems,
    favorites,
    toggleFavorite,
    weekKey,
    setMeal,
    missingRecipeCount,
    allRecipes,
    recipeFor,
  } = useStore();
  const { toast, show, showText, undo } = useToast();

  const currentWeekKey = toKey(startOfWeek(new Date()));
  const nextWeekKey = toKey(addDays(startOfWeek(new Date()), 7));
  const weekName = weekKey === currentWeekKey ? "本周" : weekKey === nextWeekKey ? "下周" : "这一周";

  const [draft, setDraft] = useState<PlanMap | null>(null);
  const [sheet, setSheet] = useState<{ dateKey: string; slot: MealSlot } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; run: () => void } | null>(null);
  const [dragging, setDragging] = useState<{ dateKey: string; slot: MealSlot } | null>(null);
  const [dragTarget, setDragTarget] = useState<{ date: string; slot: MealSlot | null } | null>(null);
  const dragTargetRef = useRef<{ date: string; slot: MealSlot | null } | null>(null);
  const setTarget = (next: { date: string; slot: MealSlot | null } | null) => {
    const prev = dragTargetRef.current;
    if (prev?.date === next?.date && prev?.slot === next?.slot) return;
    dragTargetRef.current = next;
    setDragTarget(next);
  };
  const [slotMenu, setSlotMenu] = useState<{ dateKey: string; slot: MealSlot } | null>(null);
  const [rowActions, setRowActions] = useState<{ dateKey: string; slot: MealSlot } | null>(null);
  /** AI 排餐：busy 时星星转圈；pop 记下刚补进来的餐位，让它们依次弹入。 */
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState<{ date: string; slots: MealSlot[] } | null>(null);

  const dayColumns = useRef<Record<string, { x: number; width: number }>>({});
  const dayRefs = useRef<Record<string, React.ComponentRef<typeof View> | null>>({});
  const rowRects = useRef<Record<string, { top: number; bottom: number }>>({});
  const rowRefs = useRef<Record<string, React.ComponentRef<typeof View> | null>>({});

  const measureDays = () => {
    Object.entries(dayRefs.current).forEach(([key, node]) => {
      node?.measureInWindow((x, _y, width) => {
        dayColumns.current[key] = { x, width };
      });
    });
    Object.entries(rowRefs.current).forEach(([key, node]) => {
      node?.measureInWindow((_x, top, _w, height) => {
        rowRects.current[key] = { top, bottom: top + height };
      });
    });
  };

  const rowAt = (pageY: number): MealSlot | null => {
    const hits = Object.entries(rowRects.current).filter(([, rect]) => pageY >= rect.top && pageY <= rect.bottom);
    if (hits.length === 0) return null;
    const inside = hits.find(([, rect]) => pageY >= rect.top + ROW_GAP / 2 && pageY <= rect.bottom - ROW_GAP / 2);
    return inside ? (inside[0] as MealSlot) : null;
  };

  const dayAt = (pageX: number) => {
    let best: { key: string; distance: number } | null = null;
    for (const [key, rect] of Object.entries(dayColumns.current)) {
      if (pageX < rect.x - DAY_DROP_PAD || pageX > rect.x + rect.width + DAY_DROP_PAD) continue;
      const distance = Math.abs(pageX - (rect.x + rect.width / 2));
      if (!best || distance < best.distance) best = { key, distance };
    }
    return best ? best.key : null;
  };

  const editing = draft !== null;
  const view = draft ?? plan;
  const dirty = useMemo(() => (draft ? JSON.stringify(draft) !== JSON.stringify(plan) : false), [draft, plan]);
  const dayPlan = useMemo(() => view[selectedDate] ?? {}, [view, selectedDate]);
  const weekEmpty = weekDays.every((key) => Object.keys(view[key] ?? {}).length === 0);
  const todayKey = toKey(new Date());
  const isToday = selectedDate === todayKey;
  const todayIndex = weekDays.indexOf(todayKey);
  const remainingDays = todayIndex >= 0 ? Math.min(3, weekDays.length - todayIndex) : 3;
  const fillLabel = remainingDays >= 3 ? "帮我排 3 天" : remainingDays === 1 ? "帮我排今天" : `帮我排剩下的 ${remainingDays} 天`;
  const selectedDateObject = parseKey(selectedDate);

  const rangeLabel = useMemo(() => {
    const first = parseKey(weekDays[0]);
    const last = parseKey(weekDays[6]);
    return `${first.getMonth() + 1}.${first.getDate()} – ${last.getMonth() + 1}.${last.getDate()}`;
  }, [weekDays]);

  const daySummary = useMemo(() => {
    const recipes = mealSlots.map((slot) => recipeFor(dayPlan, slot)).filter(Boolean);
    if (!Object.keys(dayPlan).length) return "还没排菜";
    const kcal = recipes.reduce((sum, recipe) => sum + (recipe?.calories ?? 0), 0);
    return `${Object.keys(dayPlan).length} 餐${kcal ? ` · 约 ${kcal} 千卡` : ""}`;
  }, [dayPlan, recipeFor]);
  const dayFull = mealSlots.every((slot) => dayPlan[slot]);

  /* ---------------- 草稿编辑 ---------------- */

  const openPicker = (dateKey: string, slot: MealSlot) => setSheet({ dateKey, slot });

  const editMeal = (dateKey: string, slot: MealSlot, recipeId: string | null) => {
    if (!draft) return;
    const day = { ...(draft[dateKey] ?? {}) };
    if (recipeId) day[slot] = recipeId;
    else delete day[slot];
    setDraft({ ...draft, [dateKey]: day });
  };

  const choose = (recipeId: string) => {
    if (!sheet) return;
    // 浏览态没有草稿，走 editMeal 会什么都不发生；浏览态即时生效。
    if (draft) editMeal(sheet.dateKey, sheet.slot, recipeId);
    else {
      setMeal(sheet.dateKey, sheet.slot, recipeId);
      setPop({ date: sheet.dateKey, slots: [sheet.slot] });
    }
    setSheet(null);
  };

  const startEdit = () => {
    Haptics.selectionAsync();
    setDraft(JSON.parse(JSON.stringify(plan)) as PlanMap);
  };

  const saveEdit = () => {
    if (draft) applyPlan(draft);
    setDraft(null);
    showText(`已更新${weekName}菜单`);
  };

  const cancelEdit = () => {
    if (!dirty) {
      setDraft(null);
      return;
    }
    setConfirm({ title: "放弃这次修改？", message: "这次的调整不会保存。", label: "放弃", run: () => setDraft(null) });
  };

  const moveMeal = (fromDate: string, slot: MealSlot, delta: number) => {
    const targetDate = toKey(addDays(parseKey(fromDate), delta));
    if (!weekDays.includes(targetDate)) return;
    const recipeId = view[fromDate]?.[slot];
    if (!recipeId || !draft) return;
    const fromDay = { ...(draft[fromDate] ?? {}) };
    const toDay = { ...(draft[targetDate] ?? {}) };
    delete fromDay[slot];
    toDay[slot] = recipeId;
    setDraft({ ...draft, [fromDate]: fromDay, [targetDate]: toDay });
  };

  const moveMealTo = (fromDate: string, fromSlot: MealSlot, targetDate: string, toSlot: MealSlot) => {
    if (!weekDays.includes(targetDate)) return;
    if (fromDate === targetDate && fromSlot === toSlot) return;
    if (!draft) return;
    const moving = draft[fromDate]?.[fromSlot];
    if (!moving) return;
    const target = draft[targetDate]?.[toSlot];
    if (fromDate === targetDate) {
      const day = { ...(draft[fromDate] ?? {}) };
      if (target) day[fromSlot] = target;
      else delete day[fromSlot];
      day[toSlot] = moving;
      setDraft({ ...draft, [fromDate]: day });
      return;
    }
    const fromDay = { ...(draft[fromDate] ?? {}) };
    const toDay = { ...(draft[targetDate] ?? {}) };
    if (target) fromDay[fromSlot] = target;
    else delete fromDay[fromSlot];
    toDay[toSlot] = moving;
    setDraft({ ...draft, [fromDate]: fromDay, [targetDate]: toDay });
  };

  /* ---------------- AI 排这天 ---------------- */

  const fillDay = () => {
    if (busy || editing) return;
    const dateKey = selectedDate;
    const day = plan[dateKey] ?? {};
    const empty = mealSlots.filter((slot) => !day[slot]);
    if (!empty.length || !allRecipes.length) return;
    setBusy(true);
    Haptics.selectionAsync();
    setTimeout(() => {
      // 收藏优先，其次菜谱库；同一天不重复；早餐尽量挑 15 分钟内的快手菜。
      const byId = new Map(allRecipes.map((recipe) => [recipe.id, recipe]));
      const ids = [
        ...favorites.filter((id) => byId.has(id)),
        ...allRecipes.map((recipe) => recipe.id).filter((id) => !favorites.includes(id)),
      ];
      const used = new Set(Object.values(day).filter(Boolean) as string[]);
      const offset = Math.max(0, weekDays.indexOf(dateKey));
      const placed: MealSlot[] = [];
      empty.forEach((slot, i) => {
        let pool = ids.filter((id) => !used.has(id) && (slot !== "早餐" || (byId.get(id)?.minutes ?? 99) <= 15));
        if (!pool.length) pool = ids.filter((id) => !used.has(id));
        if (!pool.length) pool = ids;
        const pick = pool[(offset + i) % pool.length];
        used.add(pick);
        setMeal(dateKey, slot, pick);
        placed.push(slot);
      });
      setBusy(false);
      setPop({ date: dateKey, slots: placed });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      show({
        text: `已排好 ${placed.length} 餐`,
        undo: () => placed.forEach((slot) => setMeal(dateKey, slot, null)),
      });
    }, AI_THINK_MS);
  };

  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => setPop(null), 1600);
    return () => clearTimeout(t);
  }, [pop]);

  /* ---------------- 周条：滑动胶囊 + 切天方向 ---------------- */

  const [stripW, setStripW] = useState(0);
  const cellW = stripW ? (stripW - STRIP_GAP * 6) / 7 : 0;
  const activeIndex = weekDays.indexOf(selectedDate);
  const pillX = useSharedValue(0);
  // 第一次量到宽度时直接就位，之后切天才走弹簧，避免进页面时胶囊从周一飞过来。
  const pillReady = useSharedValue(0);
  useEffect(() => {
    if (!cellW || activeIndex < 0) return;
    const to = activeIndex * (cellW + STRIP_GAP);
    pillX.set(pillReady.get() ? withSpring(to, motion.spring) : to);
    pillReady.set(1);
  }, [activeIndex, cellW, pillX, pillReady]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pillX.value }] }));

  // 切天方向：往后点从右边滑入，往前点从左边滑入。
  const [direction, setDirection] = useState(1);
  const dayEnter = (direction > 0 ? FadeInRight : FadeInLeft).duration(260).easing(Easing.out(Easing.cubic));

  /* ---------------- 采购进度 ---------------- */

  const bought = shoppingItems.filter((item) => item.checked).length;
  const pending = shoppingItems.length - bought;
  const progress = shoppingItems.length ? bought / shoppingItems.length : 0;

  /* ---------------- 餐位 ---------------- */

  const swapHint = (slot: MealSlot) => (
    <View style={styles.swap}>
      <AppText size={14} weight="700" color={colors.ink}>
        {dragging!.slot} → {slot}
      </AppText>
      <View style={styles.swapBadge}>
        <AppText size={11} weight="700" color={colors.ink}>
          {dayPlan[slot] ? "松手后交换" : "移到这里"}
        </AppText>
      </View>
    </View>
  );

  const renderSlot = (slot: MealSlot) => {
    const recipe = recipeFor(dayPlan, slot);
    const isSource = dragging?.dateKey === selectedDate && dragging.slot === slot;
    const crossDay = !!dragging && !!dragTarget?.date && dragTarget.date !== selectedDate;
    const swapInto = !!dragging && dragging.slot !== slot && dragTarget?.date === selectedDate && dragTarget.slot === slot;
    const popOrder = pop?.date === selectedDate ? pop.slots.indexOf(slot) : -1;

    let body: React.ReactNode;
    if (swapInto) {
      body = swapHint(slot);
    } else if (!recipe && dayPlan[slot]) {
      // 有 recipeId 却查不到菜时不能伪装成空餐位：那样计数说满了、界面却是空的。
      body = (
        <Pressable
          onPress={() => (editing ? setRowActions({ dateKey: selectedDate, slot }) : undefined)}
          style={[styles.empty, styles.missing]}
          accessibilityRole="button"
          accessibilityLabel="这道菜暂时取不到"
        >
          <AppText size={14} weight="700" color={colors.muted}>这道菜暂时取不到</AppText>
          <AppText size={12} color={colors.placeholder} style={{ marginTop: 3 }} numberOfLines={1}>
            同步后再看看
          </AppText>
        </Pressable>
      );
    } else if (!recipe) {
      body = (
        <Pressable
          onPress={() => openPicker(selectedDate, slot)}
          style={({ pressed }) => [styles.empty, pressed && styles.emptyPressed]}
          accessibilityRole="button"
          accessibilityLabel={`添加${slot}`}
        >
          <PlusIcon size={16} color={colors.placeholder} />
          <AppText size={14} weight="700" color={colors.placeholder}>挑一道{slot}</AppText>
        </Pressable>
      );
    } else {
      const content = (
        <Pressable
          onPress={() => (editing ? setRowActions({ dateKey: selectedDate, slot }) : router.push(`/recipe/${recipe.id}`))}
          style={({ pressed }) => [styles.meal, pressed && !editing && styles.mealPressed]}
          accessibilityRole="button"
          accessibilityLabel={editing ? `调整${slot}：${recipe.name}` : `查看 ${recipe.name}`}
        >
          <View style={[styles.mealArt, { backgroundColor: slotTint[slot] }]}>
            <FoodArt kind={recipe.art} size={64} label={recipe.name} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText size={16} weight="700" numberOfLines={1}>{recipe.name}</AppText>
            <View style={styles.meta}>
              <ClockIcon size={13} color={colors.muted} />
              <AppText size={12} color={colors.muted} style={styles.num}>{recipe.minutes} 分钟</AppText>
              <View style={styles.metaDot} />
              <AppText size={12} color={colors.muted} style={styles.num}>{recipe.calories} 千卡</AppText>
            </View>
          </View>
          <View style={styles.mealTail}>
            {editing ? <GripIcon size={20} /> : <ChevronRightIcon size={16} color={colors.disabled} />}
          </View>
        </Pressable>
      );
      const placeholder = (
        <View style={styles.placeholder} accessibilityLabel={crossDay ? `${slot}已移到${weekdayOf(dragTarget!.date!)}` : `${slot}拖拽占位`}>
          {crossDay ? (
            <>
              <AppText size={13} weight="700" color={colors.muted}>{slot}将移到{weekdayOf(dragTarget!.date!)}</AppText>
              <AppText size={11} color={colors.placeholder} style={{ marginTop: 3 }}>
                {view[dragTarget!.date!]?.[slot] ? "松手交换" : "松手放下"}
              </AppText>
            </>
          ) : (
            <AppText size={12} color={colors.placeholder}>拖到其他餐位或日期</AppText>
          )}
        </View>
      );
      body = (
        <DraggableMeal
          enabled={editing}
          placeholder={placeholder}
          onLift={() => {
            measureDays();
            setDragging({ dateKey: selectedDate, slot });
            setTarget({ date: selectedDate, slot: null });
          }}
          onMove={(pageX, pageY) => {
            const date = dayAt(pageX);
            if (!date) setTarget(null);
            else if (date !== selectedDate) setTarget({ date, slot: null });
            else setTarget({ date, slot: rowAt(pageY) });
          }}
          onDrop={(pageX, pageY) => {
            const current = dragTargetRef.current;
            const date = current?.date ?? (pageX >= 0 ? dayAt(pageX) : null);
            if (date) {
              const toSlot = date === selectedDate ? rowAt(pageY) : slot;
              if (toSlot) {
                moveMealTo(selectedDate, slot, date, toSlot);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
            }
            measureDays();
            setDragging(null);
            setTarget(null);
          }}
        >
          {content}
        </DraggableMeal>
      );
      if (popOrder >= 0) {
        body = (
          <Animated.View entering={ZoomIn.delay(popOrder * 140).springify().damping(11).stiffness(190)}>{body}</Animated.View>
        );
      }
    }

    return (
      <View
        key={slot}
        ref={(node) => {
          rowRefs.current[slot] = node;
        }}
        onLayout={measureDays}
        style={[styles.slot, isSource && styles.slotDragging]}
      >
        {body}
        <View style={styles.slotLabel} pointerEvents="none">
          <AppText size={11.5} weight="700" color={colors.muted}>{slot}</AppText>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl + 60 }} showsVerticalScrollIndicator={false}>
        {/* 顶部：大标题 + 周切换 */}
        <Animated.View entering={FadeInDown.duration(motion.duration.slow)} style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.titleRow}>
            <AppText size={30} weight="800" style={{ letterSpacing: -0.6, lineHeight: 36 }}>
              {weekName}计划
            </AppText>
            <Pressable
              onPress={() => (editing ? saveEdit() : startEdit())}
              hitSlop={6}
              style={({ pressed }) => [styles.editChip, editing && styles.editChipOn, pressed && { transform: [{ scale: 0.94 }] }]}
              accessibilityRole="button"
              accessibilityLabel={editing ? "保存菜单" : "编辑菜单"}
            >
              <AppText size={13} weight="700" color={editing ? colors.white : colors.ink} maxFontSizeMultiplier={1}>
                {editing ? "保存" : "调整"}
              </AppText>
            </Pressable>
          </View>
          <View style={styles.range}>
            <Pressable onPress={() => shiftWeek(-1)} style={styles.rangeBtn} accessibilityLabel="上一周">
              <BackIcon size={18} color={colors.muted} />
            </Pressable>
            <AppText size={14} weight="700" color={colors.muted} style={styles.num}>{rangeLabel}</AppText>
            <Pressable onPress={() => shiftWeek(1)} style={styles.rangeBtn} accessibilityLabel="下一周">
              <ChevronRightIcon size={18} color={colors.muted} />
            </Pressable>
          </View>
        </Animated.View>

        {/* 周条：深色胶囊在日期间弹簧滑动 */}
        <Animated.View
          entering={FadeInDown.delay(60).duration(motion.duration.slow)}
          style={styles.strip}
          onLayout={(e) => setStripW(e.nativeEvent.layout.width)}
        >
          {cellW > 0 && activeIndex >= 0 ? <Animated.View style={[styles.pill, { width: cellW }, pillStyle]} /> : null}
          {weekDays.map((key, index) => {
            const active = key === selectedDate;
            const today = key === todayKey;
            const changed = editing && JSON.stringify(view[key] ?? {}) !== JSON.stringify(plan[key] ?? {});
            const isDrop = dragTarget?.date === key && !!dragging;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  if (dragging || active) return;
                  Haptics.selectionAsync();
                  setDirection(index >= activeIndex ? 1 : -1);
                  setSelectedDate(key);
                }}
                ref={(node) => {
                  dayRefs.current[key] = node;
                }}
                onLayout={measureDays}
                style={({ pressed }) => [
                  styles.day,
                  changed && styles.dayChanged,
                  isDrop && (active ? styles.dayDropActive : styles.dayDrop),
                  pressed && { transform: [{ scale: 0.92 }] },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`周${weekdayLabels[index]} ${parseKey(key).getDate()} 日`}
              >
                <AppText size={12} color={active ? colors.onDeepBody : colors.muted}>周{weekdayLabels[index]}</AppText>
                <AppText size={19} weight="800" color={active ? colors.white : colors.ink} style={[styles.num, { marginTop: 2 }]}>
                  {parseKey(key).getDate()}
                </AppText>
                <View style={styles.dots}>
                  {mealSlots.map((slot) => {
                    const filled = !!view[key]?.[slot];
                    return (
                      <View
                        key={slot}
                        style={[
                          styles.dot,
                          {
                            backgroundColor: filled
                              ? active
                                ? colors.sun
                                : colors.accent
                              : active
                                ? "rgba(255,255,255,0.25)"
                                : colors.border,
                          },
                        ]}
                      />
                    );
                  })}
                </View>
                {today ? (
                  <View style={styles.todayBadge}>
                    <AppText size={10} weight="700" color={colors.white} maxFontSizeMultiplier={1}>今</AppText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </Animated.View>

        {editing ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.hintBar}>
            <AppText size={12} color={colors.ink} style={{ flex: 1 }}>
              长按拖动，调换餐位
            </AppText>
            <Pressable onPress={cancelEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel="取消编辑">
              <AppText size={12} weight="700" color={colors.muted}>取消</AppText>
            </Pressable>
          </Animated.View>
        ) : null}

        {weekEmpty && !editing ? (
          <Animated.View entering={FadeInDown.delay(120).duration(motion.duration.slow)} style={styles.emptyWeek}>
            <View style={styles.emptyWeekIcon}>
              <SparkleIcon size={22} color={colors.ink} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText size={15} weight="700">这一周还是空的</AppText>
              <AppText size={12} color={colors.muted} style={{ marginTop: 3, lineHeight: 18 }}>
                先帮你排三天，随时能改
              </AppText>
              <Pressable
                onPress={() => {
                  const placed = planThreeDays();
                  if (placed > 0) setPop({ date: selectedDate, slots: [...mealSlots] });
                  showText(placed > 0 ? `已排好 ${placed} 餐` : "这几天已经排满了");
                }}
                style={({ pressed }) => [styles.emptyWeekCta, pressed && { transform: [{ scale: 0.95 }] }]}
                accessibilityLabel={fillLabel}
              >
                <AppText size={13} weight="700" color={colors.white}>{fillLabel}</AppText>
              </Pressable>
            </View>
          </Animated.View>
        ) : null}

        {/* 当天标题 + AI 排餐 */}
        <View style={styles.dayHead}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <AppText size={21} weight="800" style={{ letterSpacing: -0.3 }} numberOfLines={1}>
              {isToday ? "今天 · " : ""}
              {isToday ? weekdayOf(selectedDate) : `${selectedDateObject.getMonth() + 1} 月 ${selectedDateObject.getDate()} 日 · ${weekdayOf(selectedDate)}`}
            </AppText>
            <AppText size={13} color={colors.muted} style={[styles.num, { marginTop: 2 }]}>{daySummary}</AppText>
          </View>
          {editing || weekEmpty ? null : (
            <Pressable
              onPress={fillDay}
              disabled={dayFull || busy}
              style={({ pressed }) => [styles.ai, dayFull && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.94 }] }]}
              accessibilityRole="button"
              accessibilityLabel={dayFull ? "这天排满了" : "帮我排这天"}
              accessibilityState={{ disabled: dayFull, busy }}
            >
              <SpinningSparkle spinning={busy} />
              <AppText size={13.5} weight="700" color={colors.sunText}>
                {busy ? "正在搭配…" : dayFull ? "这天排满了" : "帮我排这天"}
              </AppText>
            </Pressable>
          )}
        </View>

        <Animated.View key={selectedDate} entering={dayEnter} style={styles.slots}>
          {mealSlots.map(renderSlot)}
        </Animated.View>

        {/* 采购清单入口：叶子绿进度条 */}
        <Animated.View entering={FadeInDown.delay(180).duration(motion.duration.slow)}>
          <Pressable
            style={({ pressed }) => [styles.shop, pressed && { transform: [{ scale: 0.98 }] }]}
            onPress={() => router.push("/shopping-list")}
            accessibilityRole="button"
            accessibilityLabel={`打开${weekName}采购清单`}
          >
            <View style={styles.shopIcon}>
              <BasketIcon size={26} color={colors.leafText} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText size={16} weight="800" numberOfLines={1}>{weekName}采购清单</AppText>
              <AppText size={13} color={colors.leafText} style={[styles.num, { marginTop: 2 }]} numberOfLines={1}>
                {shoppingItems.length
                  ? pending
                    ? `还差 ${pending} 样 · 已买 ${bought} 样`
                    : `${bought} 样都买齐了`
                  : "排好菜，食材自动进清单"}
                {missingRecipeCount > 0 ? ` · ${missingRecipeCount} 道未计入` : ""}
              </AppText>
              <ProgressBar value={progress} />
            </View>
            <ChevronRightIcon size={18} color={colors.leafText} />
          </Pressable>
        </Animated.View>

        {editing ? null : (
          <Animated.View entering={FadeInDown.delay(240).duration(motion.duration.slow)} style={styles.section}>
            <AppText size={17} weight="800" style={{ marginBottom: spacing.md }}>换个口味？</AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: spacing.xl }}>
              {allRecipes.slice(1, 6).map((recipe, i) => (
                <Pressable
                  key={recipe.id}
                  onPress={() => router.push(`/recipe/${recipe.id}`)}
                  style={({ pressed }) => [styles.suggestion, pressed && { transform: [{ scale: 0.96 }] }]}
                  accessibilityLabel={`查看 ${recipe.name}`}
                >
                  <View style={[styles.suggestionArt, { backgroundColor: [colors.skySoft, colors.sunSoft, colors.leafSoft, colors.accentSoft][i % 4] }]}>
                    <FoodArt kind={recipe.art} size={74} label={recipe.name} />
                  </View>
                  <AppText size={13} weight="700" numberOfLines={1} style={{ marginTop: 8 }}>{recipe.name}</AppText>
                  <AppText size={11} color={colors.muted} style={[styles.num, { marginTop: 1 }]}>{recipe.minutes} 分钟</AppText>
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        )}
      </ScrollView>

      <Toast toast={toast} bottom={spacing.lg} onUndo={undo} />

      {rowActions ? (
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRowActions(null)} accessibilityLabel="关闭餐次操作" />
          <Animated.View entering={FadeInDown.springify().damping(18)} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <AppText size={18} weight="800">
              {recipeFor(view[rowActions.dateKey] ?? {}, rowActions.slot)?.name ?? rowActions.slot}
            </AppText>
            <AppText size={12} color={colors.muted} style={{ marginTop: 3, marginBottom: spacing.md }}>
              {weekdayOf(rowActions.dateKey)} · {rowActions.slot}
            </AppText>
            <SheetAction icon={<SwapIcon size={20} color={colors.ink} />} label="移到其他餐次" onPress={() => { setSlotMenu(rowActions); setRowActions(null); }} />
            <SheetAction icon={<PlusIcon size={20} color={colors.ink} />} label="换一道菜" onPress={() => { openPicker(rowActions.dateKey, rowActions.slot); setRowActions(null); }} />
            <SheetAction icon={<BackIcon size={20} color={colors.ink} />} label="挪到前一天" onPress={() => { moveMeal(rowActions.dateKey, rowActions.slot, -1); setRowActions(null); }} />
            <SheetAction icon={<ChevronRightIcon size={20} color={colors.ink} />} label="挪到后一天" onPress={() => { moveMeal(rowActions.dateKey, rowActions.slot, 1); setRowActions(null); }} />
            <SheetAction
              icon={<TrashIcon size={20} color={colors.danger} />}
              label="删除这一餐"
              danger
              onPress={() => { editMeal(rowActions.dateKey, rowActions.slot, null); setRowActions(null); }}
            />
            <Pressable onPress={() => setRowActions(null)} style={styles.cancelRow} accessibilityRole="button">
              <AppText size={15} weight="700" color={colors.muted}>取消</AppText>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}

      {slotMenu ? (
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSlotMenu(null)} accessibilityLabel="关闭餐次菜单" />
          <Animated.View entering={FadeInDown.springify().damping(18)} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <AppText size={18} weight="800" style={{ marginBottom: spacing.md }}>移到</AppText>
            {mealSlots.map((target) => {
              const current = view[slotMenu.dateKey]?.[target];
              const isSource = target === slotMenu.slot;
              return (
                <Pressable
                  key={target}
                  onPress={() => {
                    moveMealTo(slotMenu.dateKey, slotMenu.slot, slotMenu.dateKey, target);
                    setSlotMenu(null);
                  }}
                  disabled={isSource}
                  style={[styles.actionRow, isSource && { opacity: 0.45 }]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isSource, selected: isSource }}
                >
                  <View style={[styles.slotSwatch, { backgroundColor: slotTint[target] }]} />
                  <AppText size={15} weight={isSource ? "400" : "700"} color={isSource ? colors.muted : colors.ink} style={{ flex: 1 }}>
                    {target}
                  </AppText>
                  <AppText size={12} color={colors.muted}>{isSource ? "当前位置" : current ? "交换" : "移到这里"}</AppText>
                </Pressable>
              );
            })}
          </Animated.View>
        </View>
      ) : null}

      {sheet ? (
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheet(null)} accessibilityLabel="关闭选择器" />
          <Animated.View entering={FadeInDown.springify().damping(18)} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <AppText size={18} weight="800">挑一道{sheet.slot}</AppText>
            <AppText size={12} color={colors.muted} style={{ marginTop: 3, marginBottom: spacing.md }}>
              {parseKey(sheet.dateKey).getMonth() + 1} 月 {parseKey(sheet.dateKey).getDate()} 日 · {weekdayOf(sheet.dateKey)}
            </AppText>
            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {allRecipes.map((recipe) => {
                const picked = view[sheet.dateKey]?.[sheet.slot] === recipe.id;
                const favored = favorites.includes(recipe.id);
                return (
                  <View key={recipe.id} style={styles.sheetRow}>
                    <Pressable
                      style={({ pressed }) => [styles.sheetPick, pressed && { opacity: 0.7 }]}
                      onPress={() => choose(recipe.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`选择 ${recipe.name}`}
                    >
                      <View style={[styles.sheetArt, { backgroundColor: slotTint[sheet.slot] }]}>
                        <FoodArt kind={recipe.art} size={44} label={recipe.name} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText size={15} weight="700">{recipe.name}</AppText>
                        <AppText size={12} color={colors.muted} style={{ marginTop: 2 }}>
                          {recipeMinutes(recipe)} · {recipeCalories(recipe)}
                        </AppText>
                      </View>
                      {picked ? (
                        <View style={styles.picked}>
                          <AppText size={11} weight="700" color={colors.leafText}>当前</AppText>
                        </View>
                      ) : null}
                    </Pressable>
                    <Pressable onPress={() => toggleFavorite(recipe.id)} hitSlop={10} style={styles.sheetHeart} accessibilityLabel={favored ? "取消收藏" : "收藏"}>
                      <HeartIcon size={20} filled={favored} color={favored ? colors.accent : colors.placeholder} />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
            {view[sheet.dateKey]?.[sheet.slot] ? (
              <Pressable
                onPress={() => {
                  if (draft) editMeal(sheet.dateKey, sheet.slot, null);
                  else setMeal(sheet.dateKey, sheet.slot, null);
                  setSheet(null);
                }}
                style={styles.clearRow}
              >
                <AppText size={14} weight="700" color={colors.danger}>清空这一餐</AppText>
              </Pressable>
            ) : null}
          </Animated.View>
        </View>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.run();
            setConfirm(null);
          }}
        />
      ) : null}
    </View>
  );
}

/** AI 按钮里的星星：搭配中匀速转圈。 */
function SpinningSparkle({ spinning }: { spinning: boolean }) {
  const deg = useSharedValue(0);
  useEffect(() => {
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
      <SparkleIcon size={17} color={colors.sunText} />
    </Animated.View>
  );
}

function ProgressBar({ value }: { value: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.set(withTiming(value, { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, [value, w]);
  const style = useAnimatedStyle(() => ({ width: `${Math.round(w.value * 1000) / 10}%` }));
  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.barFill, style]} />
    </View>
  );
}

function SheetAction({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      <View style={[styles.actionIcon, danger && { backgroundColor: colors.accentSoft }]}>{icon}</View>
      <AppText size={15} weight="700" color={danger ? colors.danger : colors.ink} style={{ flex: 1 }}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  num: { fontVariant: ["tabular-nums"] },
  header: { paddingHorizontal: spacing.xl },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  editChip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  editChipOn: { backgroundColor: colors.primary },
  range: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4, marginLeft: -10 },
  rangeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },

  strip: { flexDirection: "row", gap: STRIP_GAP, marginHorizontal: spacing.lg, marginTop: spacing.sm },
  pill: { position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: 18, backgroundColor: colors.primary },
  day: { flex: 1, alignItems: "center", paddingTop: 10, paddingBottom: 9, borderRadius: 18, borderWidth: 1.5, borderColor: "transparent" },
  dayChanged: { borderColor: colors.sun, borderStyle: "dashed" },
  dayDrop: { backgroundColor: colors.sunSoft, borderColor: colors.sun },
  dayDropActive: { borderColor: colors.sun, borderWidth: 2 },
  dots: { flexDirection: "row", gap: 3, height: 5, marginTop: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  todayBadge: {
    position: "absolute",
    top: -5,
    right: 0,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.canvas,
  },

  hintBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: colors.sunSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  emptyWeek: {
    flexDirection: "row",
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.sunSoft,
  },
  emptyWeekIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.sun,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-6deg" }],
  },
  emptyWeekCta: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: 18,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  dayHead: { flexDirection: "row", alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.lg, paddingHorizontal: spacing.xl },
  ai: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.sunSoft,
  },

  section: { paddingLeft: spacing.xl, marginTop: spacing.xxl },
  slots: { paddingHorizontal: spacing.xl, gap: 18, paddingTop: 8 },
  slot: { minHeight: 92 },
  slotDragging: { zIndex: 40, elevation: 14 },
  slotLabel: {
    position: "absolute",
    left: 14,
    top: -9,
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: colors.canvas,
    justifyContent: "center",
    zIndex: 3,
  },
  meal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 10,
    paddingRight: 4,
    minHeight: 92,
    borderRadius: 22,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  mealPressed: { transform: [{ scale: 0.98 }] },
  mealArt: { width: 72, height: 72, borderRadius: 16, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.disabled, marginHorizontal: 3 },
  mealTail: { width: 40, height: 56, alignItems: "center", justifyContent: "center" },
  empty: {
    minHeight: 92,
    borderRadius: 22,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyPressed: { backgroundColor: colors.surfaceAlt, transform: [{ scale: 0.98 }] },
  missing: { flexDirection: "column", gap: 0, paddingHorizontal: spacing.lg },
  placeholder: {
    flex: 1,
    minHeight: 92,
    borderRadius: 22,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  swap: {
    minHeight: 92,
    borderRadius: 22,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.sun,
    backgroundColor: colors.sunSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  swapBadge: {
    position: "absolute",
    right: 12,
    top: -10,
    paddingHorizontal: 8,
    height: 20,
    borderRadius: 7,
    backgroundColor: colors.sun,
    justifyContent: "center",
  },

  shop: {
    marginTop: spacing.xxl,
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.leafSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  shopIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  bar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.85)", marginTop: 8, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, backgroundColor: colors.leaf },

  suggestion: { width: 116 },
  suggestionArt: { height: 104, borderRadius: radius.md, alignItems: "center", justifyContent: "center", overflow: "hidden" },

  sheetBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(23,31,46,0.36)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    ...shadow.floating,
  },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.handle, alignSelf: "center", marginBottom: spacing.lg },
  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, height: 56 },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  slotSwatch: { width: 40, height: 40, borderRadius: 12 },
  cancelRow: {
    height: 52,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  sheetPick: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  sheetArt: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  sheetHeart: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  picked: { backgroundColor: colors.leafSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  clearRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: "center",
  },
});
