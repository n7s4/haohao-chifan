import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../components/Common";
import { FoodArt } from "../components/FoodArt";
import { BackIcon, ChevronRightIcon } from "../components/Icons";
import { ART_TINTS } from "../components/RecipeTile";
import { FAT_LOSS_MEALS, MAIN_MIN_PROTEIN, fatLossList } from "../data/fatLoss";
import { type FatLossMeal, recipeMinutes } from "../data/recipes";
import { useStore } from "../state/store";
import { colors, motion, radius, shadow, spacing } from "../theme";

const IS_ANDROID = Platform.OS === "android";
const PAD = 20;

const rise = (i: number) =>
  FadeInDown.delay(60 + i * 40).duration(motion.duration.slow).easing(Easing.out(Easing.cubic));

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)");
};

const SEGMENTS: { key: FatLossMeal | null; label: string }[] = [
  { key: null, label: "全部" },
  ...FAT_LOSS_MEALS.map((m) => ({ key: m.key, label: m.label })),
];

export default function FatLossScreen() {
  const insets = useSafeAreaInsets();
  const { allRecipes } = useStore();
  const [meal, setMeal] = useState<FatLossMeal | null>(null);
  const all = useMemo(() => fatLossList(allRecipes), [allRecipes]);
  const shown = useMemo(() => (meal ? all.filter((r) => r.fatLoss === meal) : all), [all, meal]);
  const labelOf = (key: FatLossMeal) => FAT_LOSS_MEALS.find((m) => m.key === key)!.label;
  const limits = FAT_LOSS_MEALS.map((m) => `${m.label} ${m.maxKcal}`).join("、");

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={goBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="返回" hitSlop={6}>
          <BackIcon />
        </Pressable>
        <AppText size={17} weight="800" style={IS_ANDROID ? styles.titleAndroid : styles.titleIos}>
          减脂餐
        </AppText>
        {IS_ANDROID ? null : <View style={styles.iconSpacer} />}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={rise(0)} style={styles.intro}>
          <AppText size={20} weight="800" color={colors.leafText}>吃饱，也能瘦</AppText>
          <AppText size={14} color={colors.leafText} style={styles.introBody}>
            {`${all.length} 道家常减脂菜，少油的蒸、煮、凉拌、快炒为主。每道热量上限：${limits} 千卡；正餐蛋白质 ${MAIN_MIN_PROTEIN}g 起。`}
          </AppText>
          <AppText size={12} color={colors.leafText} style={styles.introNote}>
            热量和营养数值按常见食材估算，仅供参考。
          </AppText>
        </Animated.View>

        <Animated.View entering={rise(1)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
            {SEGMENTS.map((s) => {
              const on = meal === s.key;
              const n = s.key ? all.filter((r) => r.fatLoss === s.key).length : all.length;
              return (
                <Pressable
                  key={s.label}
                  onPress={() => setMeal(s.key)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <AppText size={14} weight="700" color={on ? colors.white : colors.ink}>{s.label}</AppText>
                  <AppText size={12} weight="700" color={on ? "rgba(255,255,255,0.7)" : colors.placeholder}>{n}</AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>

        <View style={styles.list}>
          {shown.map((r, i) => (
            <Animated.View key={r.id} entering={rise(2 + Math.min(i, 8))}>
              <Pressable
                onPress={() => router.push(`/recipe/${r.id}`)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}，${r.calories} 千卡，蛋白质 ${r.nutrition?.protein ?? 0} 克`}
              >
                <View style={[styles.thumb, { backgroundColor: ART_TINTS[i % ART_TINTS.length] }]}>
                  <FoodArt kind={r.art} size={64} label={r.name} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <AppText size={16} weight="800" numberOfLines={1} style={{ flexShrink: 1 }}>{r.name}</AppText>
                    {meal ? null : (
                      <View style={styles.mealTag}>
                        <AppText size={11} weight="700" color={colors.leafText}>{labelOf(r.fatLoss!)}</AppText>
                      </View>
                    )}
                  </View>
                  <AppText size={13} color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>{r.subtitle}</AppText>
                  <AppText size={12} weight="700" color={colors.ink} style={styles.meta}>
                    {`${r.calories} 千卡 · 蛋白质 ${r.nutrition?.protein ?? "—"}g · ${recipeMinutes(r)}`}
                  </AppText>
                </View>
                <ChevronRightIcon size={16} color={colors.placeholder} />
              </Pressable>
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 12, paddingBottom: 6, minHeight: 52 },
  iconBtn: {
    width: IS_ANDROID ? 48 : 44,
    height: IS_ANDROID ? 48 : 44,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  iconSpacer: { width: 44 },
  titleIos: { flex: 1, textAlign: "center" },
  titleAndroid: { flex: 1, paddingLeft: 4 },
  intro: { marginHorizontal: PAD, marginTop: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.leafSoft },
  introBody: { marginTop: spacing.sm, lineHeight: 21 },
  introNote: { marginTop: spacing.sm, opacity: 0.75 },
  chips: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: PAD, paddingVertical: spacing.lg },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  list: { paddingHorizontal: PAD, gap: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  thumb: { width: 76, height: 76, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  mealTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.leafSoft },
  meta: { marginTop: 6, fontVariant: ["tabular-nums"] },
});
