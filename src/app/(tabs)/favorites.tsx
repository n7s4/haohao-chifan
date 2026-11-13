import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
  ZoomOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/Common";
import { FoodArt } from "../../components/FoodArt";
import { coverHeightFor, RecipeTile, splitColumns } from "../../components/RecipeTile";
import { CreateFab } from "../../components/TabBar";
import { Toast, useToast } from "../../components/Toast";
import { isQuickRecipe, type Recipe } from "../../data/recipes";
import { useRecipeCoverUris } from "../../lib/useMedia";
import { useStore } from "../../state/store";
import { colors, motion, radius, spacing } from "../../theme";

const GRID_GAP = 12;
const GRID_PAD = spacing.lg;
const CARD_MIN_H = 120;
const CARD_MAX_H = 210;

type FilterKey = "all" | "mine" | "made" | "quick";

/** 每个筛选空了时说什么、往哪儿引。 */
const EMPTY: Record<FilterKey, { title: string; text: string; cta: string; href: "/" | "/plan" | "/create-recipe"; art: "soup" | "toast" }> = {
  all: { title: "还没有收藏的菜谱", text: "在菜谱页点一下心形，就会出现在这里", cta: "去发现", href: "/", art: "soup" },
  mine: { title: "还没有自建菜谱", text: "家里的拿手菜、刷到的好菜，都可以存下来", cta: "新建一道", href: "/create-recipe", art: "toast" },
  made: { title: "这周还没开火", text: "挑一道收藏的菜，今晚就试试", cta: "去计划", href: "/plan", art: "soup" },
  quick: { title: "没有 20 分钟内的快手菜", text: "去发现页看看快手菜", cta: "去发现", href: "/", art: "soup" },
};

const rise = (i: number) =>
  FadeInDown.delay(Math.min(i, 8) * 55).duration(motion.duration.slow).easing(Easing.out(Easing.cubic));

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { favorites, toggleFavorite, allRecipes, cookedLog, weekDays } = useStore();
  const { toast, show, undo } = useToast();
  const [filter, setFilter] = useState<FilterKey>("all");

  const saved = useMemo(
    () => allRecipes.filter((recipe) => favorites.includes(recipe.id)),
    [allRecipes, favorites]
  );
  const coverUris = useRecipeCoverUris(saved);

  /** 「本周做过」和计划页、「我的」用同一个口径：当前显示周里记过一次就算。 */
  const madeThisWeek = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of cookedLog) if (weekDays.includes(entry.date)) ids.add(entry.recipeId);
    return ids;
  }, [cookedLog, weekDays]);

  const filters: [FilterKey, string, (r: Recipe) => boolean][] = [
    ["all", "全部", () => true],
    ["mine", "自建", (r) => Boolean(r.custom)],
    ["made", "做过", (r) => madeThisWeek.has(r.id)],
    ["quick", "快手菜", isQuickRecipe],
  ];
  const activeFn = filters.find(([key]) => key === filter)![2];
  const list = saved.filter(activeFn);
  const madeCount = saved.filter((r) => madeThisWeek.has(r.id)).length;

  const columnWidth = Math.floor((width - GRID_PAD * 2 - GRID_GAP) / 2);
  const measured = list.map((recipe, index) => ({
    recipe,
    index,
    artHeight: coverHeightFor(recipe.cover, index, columnWidth, CARD_MIN_H, CARD_MAX_H),
  }));
  const columns = splitColumns(measured, (item) => item.artHeight + 19 + 7 + 17 + 8, GRID_GAP);

  const unfavorite = (recipe: Recipe) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    toggleFavorite(recipe.id);
    show({
      text: `已取消收藏「${recipe.name}」`,
      undo: () => toggleFavorite(recipe.id),
      undoneText: "已放回收藏",
    });
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingBottom: spacing.xxxl + insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={rise(0)} style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
          <AppText size={32} weight="800" style={styles.title}>
            收藏
          </AppText>
          <AppText size={14} color={colors.muted} style={{ marginTop: 2 }}>
            {saved.length > 0
              ? `${saved.length} 道菜${madeCount > 0 ? ` · ${madeCount} 道本周做过` : ""}`
              : "心形点亮的菜会住在这里"}
          </AppText>
        </Animated.View>

        <Animated.View entering={rise(1)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            accessibilityRole="tablist"
          >
            {filters.map(([key, label, fn]) => {
              const on = filter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setFilter(key);
                  }}
                  style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.chipPressed]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <AppText size={14} weight="700" color={on ? colors.white : colors.ink}>
                    {label}
                  </AppText>
                  <AppText size={12} weight="700" color={on ? "rgba(255,255,255,0.7)" : colors.placeholder}>
                    {saved.filter(fn).length}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>

        {list.length === 0 ? (
          <EmptyState key={filter} kind={filter} />
        ) : (
          <View style={styles.grid}>
            {columns.map((bucket, columnIndex) => (
              <View key={`${filter}-${columnIndex}`} style={{ width: columnWidth, gap: GRID_GAP }}>
                {bucket.map(({ recipe, artHeight, index }) => (
                  <Animated.View
                    key={recipe.id}
                    entering={rise(index + 2)}
                    exiting={ZoomOut.duration(320).easing(Easing.in(Easing.cubic))}
                    layout={LinearTransition.springify().damping(18).stiffness(180)}
                  >
                    <RecipeTile
                      recipe={recipe}
                      artHeight={artHeight}
                      columnWidth={columnWidth}
                      coverUri={coverUris[recipe.id]}
                      meta={metaFor(recipe.minutes, recipe.steps.length)}
                      titleSize={14}
                      titleLines={1}
                      badge={recipe.custom ? "自建" : madeThisWeek.has(recipe.id) ? "本周做过" : undefined}
                      showFavorite
                      favorited
                      onToggleFavorite={() => unfavorite(recipe)}
                    />
                  </Animated.View>
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <CreateFab />
      <Toast toast={toast} bottom={Platform.OS === "android" ? 84 : spacing.lg} onUndo={undo} />
    </View>
  );
}

/** 空状态：一碗轻轻上下浮动的插画 + 一句引导 + 一个去处。 */
function EmptyState({ kind }: { kind: FilterKey }) {
  const copy = EMPTY[kind];
  const reduce = useReducedMotion();
  const bob = useSharedValue(0);

  React.useEffect(() => {
    if (reduce) return;
    bob.set(
      withRepeat(
        withSequence(
          withTiming(-8, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) })
        ),
        -1
      )
    );
  }, [bob, reduce]);

  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.get() }] }));

  return (
    <Animated.View entering={FadeIn.duration(motion.duration.slow)} style={styles.empty}>
      <Animated.View style={[styles.emptyPic, bobStyle]}>
        <FoodArt kind={copy.art} size={150} />
      </Animated.View>
      <AppText size={19} weight="800" style={{ marginTop: 14 }}>
        {copy.title}
      </AppText>
      <AppText size={14} color={colors.muted} style={styles.emptyText}>
        {copy.text}
      </AppText>
      <Pressable
        onPress={() => router.push(copy.href)}
        style={({ pressed }) => [styles.emptyCta, pressed && { transform: [{ scale: 0.97 }] }]}
        accessibilityRole="button"
      >
        <AppText size={15} weight="800" color={colors.white}>
          {copy.cta}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}

/** 「12 分钟 · 3 步」：老数据 minutes 为 0 时不要出现「0 分钟」。 */
function metaFor(minutes: number, steps: number): string {
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} 分钟`);
  if (steps > 0) parts.push(`${steps} 步`);
  return parts.join(" · ") || "还没有步骤";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: spacing.xl },
  title: { letterSpacing: -0.6 },
  chips: { gap: 8, paddingHorizontal: GRID_PAD, paddingTop: 14, paddingBottom: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 38,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipPressed: { transform: [{ scale: 0.96 }] },
  grid: { flexDirection: "row", gap: GRID_GAP, paddingHorizontal: GRID_PAD, marginTop: spacing.lg },
  empty: { alignItems: "center", paddingHorizontal: 32, paddingTop: 36 },
  emptyPic: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: colors.sunSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  emptyText: { marginTop: 6, marginBottom: 18, textAlign: "center" },
  emptyCta: {
    height: 48,
    paddingHorizontal: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
