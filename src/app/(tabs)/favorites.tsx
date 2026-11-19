import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
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
import { getCommunityRecipes } from "../../lib/community/api";
import {
  type CommunityFetch,
  type CommunityRecipe,
  type FavoriteEntry,
  mergeFavoriteEntries,
  parseCommunityFavoriteId,
} from "../../lib/community/logic";
import { getSupabase } from "../../lib/supabase";
import { useRecipeCoverUris } from "../../lib/useMedia";
import { useStore } from "../../state/store";
import { colors, motion, radius, spacing } from "../../theme";

const GRID_GAP = 12;
const GRID_PAD = spacing.lg;
const CARD_MIN_H = 120;
const CARD_MAX_H = 210;
const NOTE_CARD_H = 120;

type FilterKey = "all" | "mine" | "made" | "quick";

/** 每个筛选空了时说什么、往哪儿引。 */
const EMPTY: Record<FilterKey, { title: string; text: string; cta: string; href: "/" | "/plan" | "/create-recipe"; art: "soup" | "toast" }> = {
  all: { title: "还没有收藏的菜谱", text: "点亮心形，菜就会存到这里", cta: "去发现", href: "/", art: "soup" },
  mine: { title: "还没有自建菜谱", text: "存下你的拿手菜", cta: "新建一道", href: "/create-recipe", art: "toast" },
  made: { title: "这周还没开火", text: "挑一道收藏的菜，今晚就试试", cta: "去计划", href: "/plan", art: "soup" },
  quick: { title: "还没有快手菜", text: "20 分钟内能做好的菜会出现在这", cta: "去发现", href: "/", art: "soup" },
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

  // 社区菜收藏：进页面 / 收藏变化 / 点重试时一次批量拉取；generation 防止旧响应覆盖新结果。
  const communityIds = useMemo(
    () => favorites.map(parseCommunityFavoriteId).filter((id): id is string => id !== null),
    [favorites]
  );
  const idsKey = communityIds.join(",");
  const [community, setCommunity] = useState<CommunityFetch>({ state: "ok", rows: [] });
  const [retryTick, setRetryTick] = useState(0);
  const [coverFailed, setCoverFailed] = useState<Record<string, boolean>>({});
  const generation = useRef(0);
  useFocusEffect(
    useCallback(() => {
      void retryTick;
      const gen = ++generation.current;
      if (!idsKey) {
        setCommunity({ state: "ok", rows: [] });
        return;
      }
      // 已经有结果时保持原样等新结果，避免取消收藏一条就把其余卡片闪成占位。
      setCommunity((prev) => (prev.state === "ok" ? prev : { state: "loading" }));
      (async () => {
        let next: CommunityFetch;
        try {
          const res = await getCommunityRecipes(getSupabase(), idsKey.split(","));
          next = res.ok ? { state: "ok", rows: res.value } : { state: "failed" };
        } catch {
          next = { state: "failed" };
        }
        if (gen === generation.current) setCommunity(next);
      })();
      return () => {
        generation.current++;
      };
    }, [idsKey, retryTick])
  );

  const entries = useMemo(
    () => mergeFavoriteEntries(favorites, new Set(saved.map((r) => r.id)), community),
    [favorites, saved, community]
  );
  const supabase = useMemo(() => {
    try {
      return getSupabase();
    } catch {
      return null;
    }
  }, []);
  const communityCoverUri = (cr: CommunityRecipe) => {
    const path = cr.recipe.cover?.path;
    if (!path || !supabase) return undefined;
    return supabase.storage.from("community-media").getPublicUrl(path).data.publicUrl;
  };
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
  const recipeById = useMemo(() => new Map(saved.map((r) => [r.id, r])), [saved]);
  // 社区菜（含已下架 / 未加载占位）只出现在「全部」里；其他筛选只看本地菜。
  const list = entries.filter((e) => (e.kind === "local" ? activeFn(recipeById.get(e.id)!) : filter === "all"));
  const totalCount = entries.length;
  const madeCount = saved.filter((r) => madeThisWeek.has(r.id)).length;

  const columnWidth = Math.floor((width - GRID_PAD * 2 - GRID_GAP) / 2);
  const measured = list.map((entry, index) => {
    const cover =
      entry.kind === "local" ? recipeById.get(entry.id)!.cover : entry.kind === "community" ? entry.cr.recipe.cover : undefined;
    const noteCard = entry.kind === "removed" || entry.kind === "unloaded";
    return {
      entry,
      index,
      artHeight: noteCard ? NOTE_CARD_H : coverHeightFor(cover, index, columnWidth, CARD_MIN_H, CARD_MAX_H),
    };
  });
  const columns = splitColumns(measured, (item) => item.artHeight + 19 + 7 + 17 + 8, GRID_GAP);

  const unfavorite = (favId: string, name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    toggleFavorite(favId);
    show({
      text: `已取消收藏${name}`,
      undo: () => toggleFavorite(favId),
      undoneText: "已放回收藏",
    });
  };

  const renderEntry = (entry: FavoriteEntry, artHeight: number) => {
    if (entry.kind === "local") {
      const recipe = recipeById.get(entry.id)!;
      return (
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
          onToggleFavorite={() => unfavorite(recipe.id, `「${recipe.name}」`)}
        />
      );
    }
    if (entry.kind === "community") {
      const { cr } = entry;
      return (
        <RecipeTile
          recipe={{ ...cr.recipe, id: cr.id, custom: false }}
          artHeight={artHeight}
          columnWidth={columnWidth}
          coverUri={communityCoverUri(cr)}
          coverFailed={coverFailed[cr.id]}
          onCoverError={() => setCoverFailed((prev) => ({ ...prev, [cr.id]: true }))}
          stats={{ likes: cr.likeCount, comments: cr.commentCount }}
          titleSize={14}
          titleLines={1}
          showFavorite
          favorited
          onToggleFavorite={() => unfavorite(entry.favId, `「${cr.recipe.name}」`)}
          onPress={() => router.push(`/community/${cr.id}`)}
        />
      );
    }
    if (entry.kind === "removed") {
      return (
        <View style={[styles.noteCard, { height: artHeight }]}>
          <AppText size={14} weight="700" color={colors.muted}>
            已下架
          </AppText>
          <AppText size={12} color={colors.placeholder} style={{ marginTop: 3, textAlign: "center" }}>
            作者撤回了这道菜
          </AppText>
          <Pressable
            onPress={() => unfavorite(entry.favId, "已下架的菜")}
            style={({ pressed }) => [styles.noteBtn, pressed && { transform: [{ scale: 0.97 }] }]}
            accessibilityRole="button"
            accessibilityLabel="取消收藏已下架的菜"
          >
            <AppText size={13} weight="700" color={colors.ink}>
              取消收藏
            </AppText>
          </Pressable>
        </View>
      );
    }
    return (
      <Pressable
        onPress={() => entry.failed && setRetryTick((n) => n + 1)}
        disabled={!entry.failed}
        style={[styles.noteCard, { height: artHeight }]}
        accessibilityRole="button"
        accessibilityLabel={entry.failed ? "社区菜暂时加载不出来，点按重试" : "社区菜加载中"}
      >
        <AppText size={14} weight="700" color={colors.muted}>
          {entry.failed ? "暂时加载不出来" : "加载中…"}
        </AppText>
        {entry.failed ? (
          <AppText size={12} color={colors.placeholder} style={{ marginTop: 3 }}>
            点按重试
          </AppText>
        ) : null}
      </Pressable>
    );
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
            {totalCount > 0
              ? `${totalCount} 道菜${madeCount > 0 ? ` · ${madeCount} 道本周做过` : ""}`
              : "还没有收藏"}
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
                    {fn === filters[0][2] ? totalCount : saved.filter(fn).length}
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
                {bucket.map(({ entry, artHeight, index }) => (
                  <Animated.View
                    key={entry.kind === "local" ? entry.id : entry.favId}
                    entering={rise(index + 2)}
                    exiting={ZoomOut.duration(320).easing(Easing.in(Easing.cubic))}
                    layout={LinearTransition.springify().damping(18).stiffness(180)}
                  >
                    {renderEntry(entry, artHeight)}
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
  noteCard: {
    borderRadius: 22,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  noteBtn: {
    marginTop: 10,
    height: 34,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
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
