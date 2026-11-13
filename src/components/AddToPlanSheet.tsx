import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "./Common";
import { FoodArt } from "./FoodArt";
import { MealSlot, cookingIngredients, mealSlots, recipeCalories, recipeMinutes } from "../data/recipes";
import { addDays, parseKey, toKey, useStore } from "../state/store";
import { colors, motion, radius, shadow, spacing } from "../theme";

const IS_ANDROID = Platform.OS === "android";
const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const SEG_PAD = IS_ANDROID ? 0 : 4;

/** 「今天 / 明天 / 周五」——日期胶囊和完成后的按钮文案共用。 */
const dayLabel = (key: string, index: number) =>
  index === 0 ? "今天" : index === 1 ? "明天" : `周${weekdayLabels[(parseKey(key).getDay() + 6) % 7]}`;

export function AddToPlanSheet({
  recipeId,
  onClose,
  onDone,
}: {
  recipeId: string | null;
  onClose: () => void;
  /** 第三个参数是落点（「周五」「晚餐」），详情页用它把按钮改成「✓ 周五晚餐」；其他调用方可以忽略。 */
  onDone: (message: string, undo?: () => void, placed?: { day: string; slot: MealSlot }) => void;
}) {
  const insets = useSafeAreaInsets();
  const { plan, setMeal, findRecipe, recipeFor } = useStore();
  const recipe = recipeId ? findRecipe(recipeId) : undefined;
  const [dayIndex, setDayIndex] = useState(0);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => toKey(addDays(new Date(), index))),
    []
  );
  const selected = days[dayIndex];
  // 默认落在今天第一个空着的餐次；三餐都排满了就停在晚餐（设计稿默认值）。
  const [slot, setSlot] = useState<MealSlot>(
    () => mealSlots.find((item) => !recipeFor(plan[days[0]] ?? {}, item)) ?? "晚餐"
  );

  if (!recipeId || !recipe) return null;

  const current = recipeFor(plan[selected] ?? {}, slot);
  const shoppingCount = cookingIngredients(recipe).length;

  const pick = (target: MealSlot) => {
    const existing = recipeFor(plan[selected] ?? {}, target);
    setMeal(selected, target, recipeId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const day = `${parseKey(selected).getMonth() + 1} 月 ${parseKey(selected).getDate()} 日`;
    const placed = { day: dayLabel(selected, dayIndex), slot: target };
    if (existing) {
      onDone(
        `${day}${target}已换成「${recipe.name}」`,
        () => setMeal(selected, target, existing.id ?? null),
        placed
      );
    } else {
      onDone(`已加入 ${day}${target} · ${recipe.name}`, undefined, placed);
    }
  };

  let info: string;
  let warn = false;
  if (current?.id === recipe.id) {
    info = "这一餐已经是这道菜了";
  } else if (current) {
    warn = true;
    const name = current.name.length > 12 ? `${current.name.slice(0, 12)}…` : current.name;
    info = `这一餐现在是「${name}」，放进去会替换掉`;
  } else {
    info = shoppingCount ? `${shoppingCount} 样食材会进采购清单` : "这一餐还空着";
  }

  // 根节点用 Fragment：遮罩和面板都是父容器的直接子节点，卸载时两者的 exiting 动画都能跑完。
  return (
    <>
      <Animated.View
        entering={FadeIn.duration(motion.duration.base)}
        exiting={FadeOut.duration(motion.duration.base)}
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭加入计划" />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(450).easing(Easing.bezier(0.22, 1, 0.36, 1))}
        exiting={SlideOutDown.duration(300).easing(Easing.in(Easing.cubic))}
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}
        accessibilityViewIsModal
      >
        <View style={styles.grab} />
        <AppText size={21} weight="800" style={{ letterSpacing: -0.3 }}>
          哪天吃？
        </AppText>
        <View style={styles.recipeRow}>
          <View style={styles.recipeArt}>
            <FoodArt kind={recipe.art} size={34} label={recipe.name} />
          </View>
          <AppText size={13} weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
            {recipe.name}
          </AppText>
          <AppText size={12} color={colors.muted}>
            {recipeMinutes(recipe)} · {recipeCalories(recipe)}
          </AppText>
        </View>

        <View style={styles.days}>
          {days.map((key, index) => (
            <DayChip
              key={key}
              label={dayLabel(key, index)}
              date={parseKey(key)}
              active={index === dayIndex}
              filled={mealSlots.filter((item) => recipeFor(plan[key] ?? {}, item)).length}
              onPress={() => {
                if (index !== dayIndex) Haptics.selectionAsync().catch(() => {});
                setDayIndex(index);
              }}
            />
          ))}
        </View>

        <MealSegment
          value={slot}
          onChange={(next) => {
            if (next !== slot) Haptics.selectionAsync().catch(() => {});
            setSlot(next);
          }}
          busy={(item) => Boolean(recipeFor(plan[selected] ?? {}, item))}
        />

        <Animated.View key={`${selected}-${slot}`} entering={FadeIn.duration(motion.duration.fast)}>
          <AppText
            size={13}
            weight={warn ? "600" : "400"}
            color={warn ? colors.accentText : colors.muted}
            numberOfLines={2}
            style={styles.info}
          >
            {info}
          </AppText>
        </Animated.View>

        <Pressable
          onPress={() => pick(slot)}
          accessibilityRole="button"
          accessibilityLabel={`放进${dayLabel(selected, dayIndex)}${slot}`}
          style={({ pressed }) => [styles.confirm, pressed && { transform: [{ scale: 0.97 }], opacity: 0.92 }]}
        >
          <AppText size={16} weight="700" color={colors.white}>
            放进计划
          </AppText>
        </Pressable>
      </Animated.View>
    </>
  );
}

function DayChip({
  label,
  date,
  active,
  filled,
  onPress,
}: {
  label: string;
  date: Date;
  active: boolean;
  filled: number;
  onPress: () => void;
}) {
  const press = useSharedValue(1);
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(active ? 1 : 0, { duration: motion.duration.base }));
  }, [active, on]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const fill = useAnimatedStyle(() => ({ opacity: on.value }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press.set(withTiming(0.92, { duration: 90 }))}
      onPressOut={() => press.set(withSpring(1, motion.spring))}
      style={{ flex: 1 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${date.getMonth() + 1} 月 ${date.getDate()} 日${filled ? `，已排 ${filled} 餐` : ""}`}
    >
      <Animated.View style={[styles.day, style]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.dayOn, fill]} />
        <AppText size={11} color={active ? colors.disabled : colors.muted}>
          {label}
        </AppText>
        <AppText
          size={17}
          weight="800"
          color={active ? colors.white : colors.ink}
          style={{ marginTop: 2, fontVariant: ["tabular-nums"] }}
        >
          {date.getDate()}
        </AppText>
        <View style={styles.dots}>
          {Array.from({ length: filled }, (_, i) => (
            <View key={i} style={styles.dot} />
          ))}
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** 早 / 午 / 晚分段：白色滑块弹簧跟随；Android 是描边胶囊 + 叶子绿滑块（M3）。 */
function MealSegment({
  value,
  onChange,
  busy,
}: {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
  busy: (slot: MealSlot) => boolean;
}) {
  const [width, setWidth] = useState(0);
  const index = mealSlots.indexOf(value);
  const x = useSharedValue(index);
  useEffect(() => {
    x.set(withSpring(index, motion.spring));
  }, [index, x]);
  const cell = width > 0 ? (width - SEG_PAD * 2) / mealSlots.length : 0;
  const thumb = useAnimatedStyle(() => ({
    width: cell,
    transform: [{ translateX: x.value * cell }],
  }));
  return (
    <View style={styles.seg} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {cell > 0 ? <Animated.View style={[styles.thumb, thumb]} /> : null}
      {mealSlots.map((item) => {
        const on = item === value;
        return (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            style={styles.segBtn}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${item}${busy(item) ? "，已排了菜" : ""}`}
          >
            <AppText size={14} weight="700" color={on ? colors.ink : colors.muted}>
              {item}
            </AppText>
            {busy(item) ? <View style={styles.segDot} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(23,31,46,0.4)",
    zIndex: 80,
    elevation: 20,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xl,
    paddingTop: 10,
    zIndex: 90,
    ...shadow.floating,
    // 盖过详情页 actionBar 的按钮投影（Android 按 elevation 排序）。
    elevation: 24,
  },
  grab: IS_ANDROID
    ? { width: 32, height: 4, borderRadius: 2, backgroundColor: colors.placeholder, alignSelf: "center", marginTop: 6, marginBottom: 14 }
    : { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 },
  recipeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  recipeArt: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  days: { flexDirection: "row", gap: 6, marginVertical: spacing.lg },
  day: {
    borderRadius: 14,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  dayOn: { backgroundColor: colors.ink, borderRadius: 14 },
  dots: { flexDirection: "row", gap: 2, height: 4, marginTop: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  seg: IS_ANDROID
    ? {
        flexDirection: "row",
        borderWidth: 1,
        borderColor: colors.placeholder,
        borderRadius: radius.pill,
        overflow: "hidden",
      }
    : { flexDirection: "row", backgroundColor: colors.surfaceAlt, borderRadius: 14, padding: SEG_PAD },
  thumb: IS_ANDROID
    ? { position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: radius.pill, backgroundColor: colors.leafSoft }
    : {
        position: "absolute",
        top: SEG_PAD,
        bottom: SEG_PAD,
        left: SEG_PAD,
        borderRadius: 10,
        backgroundColor: colors.surface,
        shadowColor: colors.ink,
        shadowOpacity: 0.16,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      },
  segBtn: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
  },
  segDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent },
  info: { marginTop: 10, marginBottom: 18, minHeight: 20, lineHeight: 20 },
  confirm: {
    minHeight: 52,
    borderRadius: IS_ANDROID ? radius.pill : 16,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
});
