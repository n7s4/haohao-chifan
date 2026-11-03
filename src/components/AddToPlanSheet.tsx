import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "./Common";
import { FoodArt } from "./FoodArt";
import { MealSlot, mealSlots, recipeCalories, recipeMinutes } from "../data/recipes";
import { addDays, parseKey, toKey, useStore } from "../state/store";
import { colors, radius, spacing } from "../theme";

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

export function AddToPlanSheet({
  recipeId,
  onClose,
  onDone,
}: {
  recipeId: string | null;
  onClose: () => void;
  onDone: (message: string, undo?: () => void) => void;
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

  if (!recipeId || !recipe) return null;

  const pick = (slot: MealSlot) => {
    const existing = recipeFor(plan[selected] ?? {}, slot);
    setMeal(selected, slot, recipeId);
    const day = `${parseKey(selected).getMonth() + 1} 月 ${parseKey(selected).getDate()} 日`;
    if (existing) {
      onDone(`${day}${slot}已换成「${recipe.name}」`, () =>
        setMeal(selected, slot, existing.id ?? null)
      );
    } else {
      onDone(`已加入 ${day}${slot} · ${recipe.name}`);
    }
  };

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭加入菜单" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.handle} />
        <AppText size={16} weight="800">加入菜单</AppText>
        <View style={styles.recipeRow}>
          <FoodArt kind={recipe.art} size={40} label={recipe.name} />
          <View style={{ flex: 1 }}>
            <AppText size={13} weight="600">{recipe.name}</AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 2 }}>
              {recipeMinutes(recipe)} · {recipeCalories(recipe)}
            </AppText>
          </View>
        </View>

        <View style={styles.days}>
          {days.map((key, index) => {
            const date = parseKey(key);
            const active = index === dayIndex;
            return (
              <Pressable
                key={key}
                onPress={() => setDayIndex(index)}
                style={[styles.day, active && styles.dayActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${date.getMonth() + 1} 月 ${date.getDate()} 日`}
              >
                <AppText size={10} color={active ? colors.cream : colors.muted}>
                  {index === 0 ? "今天" : index === 1 ? "明天" : `周${weekdayLabels[(date.getDay() + 6) % 7]}`}
                </AppText>
                <AppText size={15} weight="700" color={active ? colors.cream : colors.ink} style={{ marginTop: 3 }}>
                  {date.getDate()}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {mealSlots.map((slot) => {
          const current = recipeFor(plan[selected] ?? {}, slot);
          return (
            <Pressable
              key={slot}
              onPress={() => pick(slot)}
              style={styles.slotRow}
              accessibilityRole="button"
              accessibilityLabel={`加入${slot}`}
            >
              <AppText size={14} weight="600">{slot}</AppText>
              {current ? (
                <View style={styles.conflictWrap}>
                  <AppText size={10.5} weight="600" color={colors.orangeText} numberOfLines={1} style={styles.conflict}>
                    现在是 {current.name.length > 12 ? `${current.name.slice(0, 12)}…` : current.name}，加入会替换
                  </AppText>
                </View>
              ) : (
                <AppText size={11} color={colors.muted} numberOfLines={1} style={{ flex: 1, textAlign: "right" }}>
                  空闲
                </AppText>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(28,34,24,0.32)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#E0E2D5", alignSelf: "center", marginBottom: spacing.lg,
  },
  recipeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  days: { flexDirection: "row", gap: 6, paddingVertical: spacing.lg },
  day: {
    flex: 1, height: 56, borderRadius: radius.md, backgroundColor: colors.greenSoft,
    alignItems: "center", justifyContent: "center",
  },
  dayActive: { backgroundColor: colors.green },
  conflictWrap: { flex: 1, alignItems: "flex-end" },
  conflict: { textAlign: "right" },
  slotRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
  },
});
