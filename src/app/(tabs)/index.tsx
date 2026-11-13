import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  NativeScrollEvent,
  Platform,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/Common";
import { FoodArt } from "../../components/FoodArt";
import {
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  DiceIcon,
  FlameIcon,
  HeartIcon,
  SearchIcon,
} from "../../components/Icons";
import {
  coverHeightFor,
  CoverImage,
  RecipeTile,
  splitColumns,
} from "../../components/RecipeTile";
import { CreateFab, fabCollapsed } from "../../components/TabBar";
import { Toast, useToast } from "../../components/Toast";
import {
  isQuickRecipe,
  mealSlots,
  MealSlot,
  Recipe,
  recipeDifficulty,
  recipeMinutes,
} from "../../data/recipes";
import { CookSession, loadAnyCookSession } from "../../lib/cookSession";
import { useRecipeCoverUris } from "../../lib/useMedia";
import { toKey, useStore } from "../../state/store";
import { colors, motion, radius, shadow, spacing } from "../../theme";

const PAD = 20;
const GAP = 12;
/** 发现页「今日推荐」写死一道菜：首屏每天换脸，用户下次就找不到入口了。 */
const HERO_RECIPE_ID = "tomato-pasta";
const HERO_ART_HEIGHT = 210;
const REEL = 44;

/** 筛选胶囊。「暖胃汤」「一锅到底」按插画类型 / 标签判断，自建菜没填也不会误入。 */
const FILTERS: [string, (r: Recipe) => boolean][] = [
  ["全部", () => true],
  ["快手菜", isQuickRecipe],
  ["一锅到底", (r) => r.tags.includes("一锅到底")],
  ["暖胃汤", (r) => r.art === "soup"],
  ["轻食", (r) => r.calories > 0 && r.calories < 420],
];

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 10) return { hi: "早上好", ask: "早饭吃点", em: "暖暖的" };
  if (h < 14) return { hi: "中午好", ask: "午饭来点", em: "顶饱的" };
  if (h < 18) return { hi: "下午好", ask: "晚上想吃", em: "什么" };
  return { hi: "晚上好", ask: "今晚吃点", em: "热乎的" };
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { favorites, toggleFavorite, allRecipes, findRecipe, plan, setMeal } = useStore();
  const coverUris = useRecipeCoverUris(allRecipes);
  const { toast, show, undo } = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(0);
  const [session, setSession] = useState<CookSession | null>(null);
  const [coverFailed, setCoverFailed] = useState<Record<string, boolean>>({});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadAnyCookSession().then((saved) => {
        if (active) setSession(saved);
      });
      return () => {
        active = false;
        fabCollapsed.value = false;
      };
    }, [])
  );

  const now = new Date();
  const todayKey = toKey(now);
  const today = plan[todayKey] ?? {};
  const hello = greeting(now);

  const columnWidth = Math.floor((width - PAD * 2 - GAP) / 2);
  const heroRecipe = findRecipe(HERO_RECIPE_ID) ?? allRecipes[0];

  const list = useMemo(() => {
    const q = query.trim();
    const byFilter = allRecipes.filter(FILTERS[filter][1]);
    if (!q) return byFilter;
    return byFilter.filter(
      (r) =>
        r.name.includes(q) ||
        r.tags.some((tag) => tag.includes(q)) ||
        r.ingredients.some((item) => item.name.includes(q))
    );
  }, [allRecipes, query, filter]);

  const columns = useMemo(() => {
    const measured = list.map((recipe, index) => ({
      recipe,
      index,
      height: coverHeightFor(recipe.cover, index, columnWidth, 130, 220),
    }));
    return splitColumns(measured, (item) => item.height + 22 + 38 + 30 + GAP, GAP);
  }, [list, columnWidth]);

  const onToggleFavorite = (id: string) => {
    const on = !favorites.includes(id);
    toggleFavorite(id);
    Haptics.selectionAsync().catch(() => {});
    if (!on) show({ text: "已取消收藏", undo: () => toggleFavorite(id) });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const collapsed = e.nativeEvent.contentOffset.y > 40;
    if (fabCollapsed.value !== collapsed) fabCollapsed.value = collapsed;
  };

  const listTitle = query.trim() ? `搜「${query.trim()}」` : filter === 0 ? "全部菜谱" : FILTERS[filter][0];
  const heroFav = heroRecipe ? favorites.includes(heroRecipe.id) : false;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl + 56 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        {/* 问候 */}
        <Animated.View entering={rise(0)} style={[styles.hello, { paddingTop: insets.top + spacing.md }]}>
          <View style={{ flex: 1 }}>
            <AppText size={12} weight="700" color={colors.muted} style={styles.eyebrow}>
              {`${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAYS[now.getDay()]}`}
            </AppText>
            <AppText size={28} weight="800" style={styles.helloTitle}>
              {`${hello.hi}，\n${hello.ask}`}
              <AppText size={28} weight="800" color={colors.accentText}>{hello.em}</AppText>？
            </AppText>
          </View>
          <Pressable
            onPress={() => router.navigate("/profile")}
            style={styles.avatar}
            accessibilityRole="button"
            accessibilityLabel="我的"
          >
            <AppText size={17} weight="800">饭</AppText>
          </Pressable>
        </Animated.View>

        {/* 搜索 */}
        <Animated.View entering={rise(1)} style={styles.search}>
          <SearchIcon color={colors.placeholder} size={20} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜菜名或食材"
            placeholderTextColor={colors.placeholder}
            style={styles.searchInput}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </Animated.View>

        {/* 筛选 */}
        <Animated.View entering={rise(2)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            accessibilityRole="tablist"
          >
            {FILTERS.map(([label, fn], i) => {
              const on = filter === i;
              return (
                <Pressable
                  key={label}
                  onPress={() => setFilter(i)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <AppText size={14} weight="700" color={on ? colors.white : colors.ink}>{label}</AppText>
                  <AppText size={12} weight="700" color={on ? "rgba(255,255,255,0.7)" : colors.placeholder}>
                    {allRecipes.filter(fn).length}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>

        {/* 今天的菜单 */}
        <Animated.View entering={rise(3)} style={styles.today}>
          <View style={styles.todayTop}>
            <AppText size={17} weight="800" color={colors.white}>今天的菜单</AppText>
            <Pressable
              onPress={() => router.navigate("/plan")}
              hitSlop={10}
              style={styles.todayLink}
              accessibilityRole="button"
            >
              <AppText size={13} color={colors.onDeepSub}>本周计划</AppText>
              <ChevronRightIcon size={14} color={colors.onDeepSub} />
            </Pressable>
          </View>
          <View style={styles.meals}>
            {mealSlots.map((slot) => (
              <MealCard
                key={slot}
                slot={slot}
                recipe={findRecipe(today[slot])}
                pool={allRecipes.filter((r) => !Object.values(today).includes(r.id))}
                onPicked={(picked) => {
                  setMeal(todayKey, slot, picked.id);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  show({ text: `${slot}就吃${picked.name}`, undo: () => setMeal(todayKey, slot, null) });
                }}
              />
            ))}
          </View>
        </Animated.View>

        {/* 继续上次烹饪 */}
        {session ? (
          <Animated.View entering={rise(4)}>
            <Pressable
              style={styles.resume}
              onPress={() => router.push(`/cook/${session.recipeId}?resume=1`)}
              accessibilityLabel={`继续上次烹饪：${session.recipeName} 第 ${session.step + 1} 步`}
            >
              <View style={styles.resumeDot} />
              <View style={{ flex: 1 }}>
                <AppText size={11} weight="700" color={colors.accentText}>继续上次烹饪</AppText>
                <AppText size={14} weight="700" style={{ marginTop: 2 }}>
                  {session.recipeName} · 第 {session.step + 1} 步
                </AppText>
              </View>
              <View style={styles.resumeBtn}>
                <AppText size={13} weight="700" color={colors.white}>继续</AppText>
              </View>
            </Pressable>
          </Animated.View>
        ) : null}

        {/* 今日推荐 */}
        {heroRecipe && !query.trim() && filter === 0 ? (
          <Animated.View entering={rise(4)}>
            <SectionHead title="今日推荐" />
            {/* 收藏按钮和卡片是兄弟节点：按钮不能嵌在按钮里（web 端会报 DOM 嵌套错误）。 */}
            <View style={styles.heroWrap}>
            <Pressable
              style={({ pressed }) => [styles.hero, pressed && { transform: [{ scale: 0.98 }] }]}
              onPress={() => router.push(`/recipe/${heroRecipe.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`查看推荐 ${heroRecipe.name}`}
            >
              <View style={styles.heroArt}>
                <HeroPlate>
                  <FoodArt kind={heroRecipe.art} size={Math.round(HERO_ART_HEIGHT * 0.86)} label={heroRecipe.name} />
                </HeroPlate>
                {coverUris[heroRecipe.id] && !coverFailed[heroRecipe.id] ? (
                  <View style={StyleSheet.absoluteFill}>
                    <CoverImage
                      uri={coverUris[heroRecipe.id]!}
                      onError={() => setCoverFailed((prev) => ({ ...prev, [heroRecipe.id]: true }))}
                    />
                  </View>
                ) : null}
                <View style={styles.heroBadge}>
                  <AppText size={12.5} weight="700" color={colors.accentText}>
                    {[recipeMinutes(heroRecipe), heroRecipe.tags[0]].filter(Boolean).join(" · ")}
                  </AppText>
                </View>
              </View>
              <View style={styles.heroInfo}>
                <AppText size={22} weight="800" numberOfLines={2} style={{ lineHeight: 28, letterSpacing: -0.4 }}>
                  {heroRecipe.name}
                </AppText>
                <View style={styles.metaRow}>
                  <Meta icon={<ClockIcon size={14} />} text={recipeMinutes(heroRecipe)} />
                  <Meta text={recipeDifficulty(heroRecipe)} />
                  {heroRecipe.calories > 0 ? (
                    <Meta icon={<FlameIcon size={14} />} text={`${heroRecipe.calories} 千卡`} />
                  ) : null}
                </View>
              </View>
            </Pressable>
            <Pressable
                  onPress={() => onToggleFavorite(heroRecipe.id)}
                  style={styles.heroHeart}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityState={{ selected: heroFav }}
                  accessibilityLabel={heroFav ? "取消收藏" : "收藏菜谱"}
                >
                  <HeartIcon size={22} filled={heroFav} color={heroFav ? colors.accent : colors.ink} />
                </Pressable>
            </View>
          </Animated.View>
        ) : null}

        {/* 列表 */}
        <SectionHead title={listTitle} count={`${list.length} 道`} />
        {list.length === 0 ? (
          <View style={styles.empty}>
            <AppText size={14} color={colors.muted} style={{ textAlign: "center" }}>
              没找到这道菜
            </AppText>
            <Pressable
              onPress={() => router.push("/create-recipe")}
              hitSlop={8}
              style={{ marginTop: spacing.md }}
              accessibilityRole="button"
            >
              <AppText size={14} weight="700" color={colors.accentText}>自己新建一道 →</AppText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.feed}>
            {columns.map((bucket, col) => (
              <View key={col} style={{ width: columnWidth, gap: GAP }}>
                {bucket.map(({ recipe, index, height }) => (
                  <Animated.View key={recipe.id} entering={FadeInDown.delay(Math.min(index, 8) * 50).springify().damping(16)}>
                    <RecipeTile
                      recipe={recipe}
                      artHeight={height}
                      columnWidth={columnWidth}
                      coverUri={coverUris[recipe.id]}
                      coverFailed={coverFailed[recipe.id]}
                      onCoverError={() => setCoverFailed((prev) => ({ ...prev, [recipe.id]: true }))}
                      showFavorite
                      favorited={favorites.includes(recipe.id)}
                      onToggleFavorite={() => onToggleFavorite(recipe.id)}
                    />
                  </Animated.View>
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <CreateFab />
      {/* Android 右下角有 FAB，toast 抬到它上面。 */}
      <Toast toast={toast} bottom={Platform.OS === "android" ? 84 : spacing.lg} onUndo={undo} />
    </View>
  );
}

/** 分段入场：每块晚 60ms 从下方浮上来（设计稿 .rise）。 */
const rise = (i: number) => FadeInDown.delay(i * 60).duration(motion.duration.slow).easing(Easing.out(Easing.cubic));

function SectionHead({ title, count }: { title: string; count?: string }) {
  return (
    <View style={styles.sectionHead}>
      <AppText size={20} weight="800" style={{ letterSpacing: -0.3 }}>{title}</AppText>
      {count ? <AppText size={13} color={colors.muted}>{count}</AppText> : null}
    </View>
  );
}

function Meta({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <View style={styles.meta}>
      {icon}
      <AppText size={13} color={colors.muted}>{text}</AppText>
    </View>
  );
}

/** 推荐菜的盘子从右侧旋转滑入（设计稿 plateIn）。 */
function HeroPlate({ children }: { children: React.ReactNode }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withTiming(1, { duration: 1100, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [
      { translateX: (1 - t.value) * 120 },
      { rotate: `${(1 - t.value) * 70}deg` },
      { scale: 0.7 + t.value * 0.3 },
    ],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * 今天的一餐。有菜就显示缩略图；空着就给一个「随便吃点」老虎机：
 * 14 格菜品滚过去，最后一格停在抽中的菜上，再弹一下落位。
 */
function MealCard({
  slot,
  recipe,
  pool,
  onPicked,
}: {
  slot: MealSlot;
  recipe: Recipe | undefined;
  pool: Recipe[];
  onPicked: (recipe: Recipe) => void;
}) {
  const [strip, setStrip] = useState<Recipe[] | null>(null);
  const offset = useSharedValue(0);
  const pop = useSharedValue(1);

  const reelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  useEffect(() => {
    if (recipe) pop.set(withSequence(withTiming(0.9, { duration: 80 }), withSpring(1, motion.spring)));
  }, [recipe, pop]);

  const finish = (picked: Recipe) => {
    setStrip(null);
    onPicked(picked);
  };

  const spin = () => {
    if (strip || pool.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const picked = pool[Math.floor(Math.random() * pool.length)];
    const seq = Array.from({ length: 14 }, (_, i) => pool[i % pool.length]).concat(picked);
    setStrip(seq);
    offset.set(0);
    offset.set(withTiming(
      -(seq.length - 1) * REEL,
      { duration: 1500, easing: Easing.bezier(0.15, 0.7, 0.2, 1.04) },
      (done) => {
        if (done) runOnJS(finish)(picked);
      }
    ));
  };

  if (recipe) {
    return (
      <Animated.View style={[styles.meal, popStyle]}>
        <Pressable
          onPress={() => router.push(`/recipe/${recipe.id}`)}
          style={{ flex: 1, gap: 6 }}
          accessibilityRole="button"
          accessibilityLabel={`${slot}：${recipe.name}`}
        >
          <View style={styles.mealKey}>
            <AppText size={11.5} weight="700" color={colors.onDeepSub}>{slot}</AppText>
            <View style={styles.ok}>
              <CheckIcon size={9} color={colors.white} />
            </View>
          </View>
          <View style={styles.thumb}>
            <FoodArt kind={recipe.art} size={REEL} plate={false} label={recipe.name} />
          </View>
          <AppText size={12.5} weight="700" color={colors.white} numberOfLines={2} style={{ lineHeight: 16 }}>
            {recipe.name}
          </AppText>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <View style={[styles.meal, styles.mealEmpty]}>
      <AppText size={11.5} weight="700" color={colors.onDeepSub}>{slot}</AppText>
      <View style={styles.reel}>
        {strip ? (
          <Animated.View style={reelStyle}>
            {strip.map((r, i) => (
              <View key={i} style={styles.reelCell}>
                <FoodArt kind={r.art} size={REEL} plate={false} label={r.name} />
              </View>
            ))}
          </Animated.View>
        ) : (
          <AppText size={20} weight="800" color={colors.onDeepHint}>?</AppText>
        )}
      </View>
      <Pressable
        onPress={spin}
        disabled={Boolean(strip) || pool.length === 0}
        style={({ pressed }) => [styles.roll, pressed && { transform: [{ scale: 0.94 }] }]}
        accessibilityRole="button"
        accessibilityLabel={`${slot}随便吃点`}
      >
        <DiceIcon size={15} />
        <AppText size={12.5} weight="700">{strip ? "挑选中…" : "随便吃点"}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  hello: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingHorizontal: PAD },
  eyebrow: { letterSpacing: 0.6, marginBottom: 6 },
  helloTitle: { lineHeight: 34, letterSpacing: -0.6 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.sun,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 52,
    marginHorizontal: PAD,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, paddingVertical: 0 },
  chips: { gap: 8, paddingHorizontal: PAD, paddingTop: 14 },
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
  today: {
    marginHorizontal: PAD,
    marginTop: 18,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
  },
  todayTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  todayLink: { flexDirection: "row", alignItems: "center", gap: 2 },
  meals: { flexDirection: "row", gap: 8 },
  meal: {
    flex: 1,
    minHeight: 124,
    padding: 8,
    gap: 6,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  mealEmpty: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.3)",
  },
  mealKey: { flexDirection: "row", alignItems: "center", gap: 4 },
  ok: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.leaf,
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: { width: REEL, height: REEL, borderRadius: 12, overflow: "hidden", backgroundColor: colors.sunSoft },
  reel: {
    width: REEL,
    height: REEL,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  reelCell: { width: REEL, height: REEL, backgroundColor: colors.sunSoft },
  roll: {
    marginTop: "auto",
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.sun,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  resume: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: PAD,
    marginTop: spacing.md,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  resumeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  resumeBtn: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    justifyContent: "center",
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: PAD,
    marginTop: 26,
    marginBottom: 12,
  },
  heroWrap: { marginHorizontal: PAD },
  hero: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  heroArt: {
    height: HERO_ART_HEIGHT,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  heroBadge: {
    position: "absolute",
    left: 16,
    top: 16,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  heroHeart: {
    zIndex: 2,
    position: "absolute",
    right: 16,
    top: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.86)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroInfo: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 8 },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  feed: { flexDirection: "row", gap: GAP, paddingHorizontal: PAD },
  empty: { paddingVertical: spacing.xxl, paddingHorizontal: PAD, alignItems: "center" },
});
