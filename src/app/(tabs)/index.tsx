import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/Common";
import { FoodArt } from "../../components/FoodArt";
import { HeartIcon, SearchIcon } from "../../components/Icons";
import {
  categories,
  matchesCategory,
  recipeDifficulty,
  recipeMinutes,
  Recipe,
} from "../../data/recipes";
import { CookSession, loadAnyCookSession } from "../../lib/cookSession";
import { useStore } from "../../state/store";
import { colors, radius, spacing } from "../../theme";

const GUTTER = 6;
const GAP = 6;
const ART_RATIOS = [1.0, 1.28, 0.9, 1.16, 1.0, 1.28];
/** 参考小红书那种「一张一块色」的观感：插图底色按位置轮换，不要一片同色。 */
const ART_TINTS = ["#F6E9D6", "#EDF0DF", "#F3E6E0", "#EFEAF3", "#F0EEE0"];

/**
 * 图片高度档位按位置循环，不按 id hash——hash 在 30 道内置菜上会撞成一片同高，
 * 瀑布流就退化成规整网格。位置法滚动过程不变、重排只发生在切分类时。
 */
const artHeightFor = (index: number, columnWidth: number) => {
  const ratio = ART_RATIOS[index % ART_RATIOS.length];
  return Math.round(Math.min(Math.max(columnWidth * ratio, 130), 280));
};

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { favorites, toggleFavorite, allRecipes } = useStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(categories[0]);
  const [session, setSession] = useState<CookSession | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadAnyCookSession().then((saved) => {
        if (active) setSession(saved);
      });
      return () => {
        active = false;
      };
    }, [])
  );

  const columnWidth = Math.floor((width - GUTTER * 2 - GAP) / 2);

  const list = useMemo(() => {
    const normalized = query.trim();
    if (!normalized) return allRecipes.filter((recipe) => matchesCategory(recipe, category));
    return allRecipes.filter(
      (recipe) =>
        (recipe.name.includes(normalized) ||
          recipe.tags.some((tag) => tag.includes(normalized)) ||
          recipe.ingredients.some((item) => item.name.includes(normalized))) &&
        matchesCategory(recipe, category)
    );
  }, [allRecipes, query, category]);

  // 瀑布流：两列按「估算高度」贪心分配，短卡去短的那列，避免一边长一边空。
  const columns = useMemo(() => {
    const heights = [0, 0];
    const buckets: { recipe: Recipe; index: number }[][] = [[], []];
    list.forEach((recipe, index) => {
      const column = heights[0] <= heights[1] ? 0 : 1;
      buckets[column].push({ recipe, index });
      const artHeight = artHeightFor(index, columnWidth);
      const titleLines = recipe.name.length > 9 ? 2 : 1;
      heights[column] += artHeight + 22 + titleLines * 20 + 30 + GAP;
    });
    return buckets;
  }, [list, columnWidth]);

  const renderCard = ({ recipe, index }: { recipe: Recipe; index: number }) => {
    const favorited = favorites.includes(recipe.id);
    const artHeight = artHeightFor(index, columnWidth);
    // 有插画的卡：圆盘略小于图区；自建菜没有封面，用「整块色 + 小一号首字圆」，混排时同一种块。
    const artSize = recipe.art
      ? Math.round(Math.min(artHeight, columnWidth) * 0.9)
      : Math.round(columnWidth * 0.62);
    const tint = recipe.art === "salad" ? "#EDF0DF" : ART_TINTS[index % ART_TINTS.length];
    const author = recipe.custom ? "我" : "好好吃饭";
    return (
      <View key={recipe.id} style={styles.tile}>
        <Pressable
          onPress={() => router.push(`/recipe/${recipe.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`查看 ${recipe.name}`}
        >
          <View
            style={[styles.tileArt, { height: artHeight, backgroundColor: tint }]}
          >
            <FoodArt kind={recipe.art} size={artSize} label={recipe.name} />
          </View>
          <AppText size={13} weight="600" numberOfLines={2} style={styles.tileTitle}>
            {recipe.name}
          </AppText>
        </Pressable>
        <View style={styles.tileMeta}>
          <View style={styles.avatar}>
            <AppText size={9} weight="700" color={colors.cream}>
              {author.slice(0, 1)}
            </AppText>
          </View>
          <AppText size={11} color={colors.muted} numberOfLines={1} style={{ flex: 1 }} >
            {author}
          </AppText>
          <Pressable
            onPress={() => toggleFavorite(recipe.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={favorited ? "取消收藏" : "收藏菜谱"}
          >
            <HeartIcon size={14} filled={favorited} color={favorited ? colors.orange : colors.muted} />
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: spacing.xxxl + spacing.lg }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.search}>
          <SearchIcon />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索菜谱、食材"
            placeholderTextColor="#A5AB98"
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: spacing.lg }}
          style={{ marginTop: spacing.md }}
        >
          {categories.map((item) => (
            <Pressable
              key={item}
              onPress={() => setCategory(item)}
              style={[styles.chip, category === item && { backgroundColor: colors.green }]}
            >
              <AppText
                size={13}
                weight={category === item ? "600" : "400"}
                color={category === item ? colors.cream : colors.muted}
              >
                {item}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {session ? (
        <Pressable
          style={styles.resumeRow}
          onPress={() => router.push(`/cook/${session.recipeId}?resume=1`)}
          accessibilityLabel={`继续上次烹饪：${session.recipeName} 第 ${session.step + 1} 步`}
        >
          <View style={styles.resumeDot} />
          <View style={{ flex: 1 }}>
            <AppText size={10} weight="600" color={colors.orangeText} style={{ letterSpacing: 0.5 }}>
              继续上次烹饪
            </AppText>
            <AppText size={13} weight="700" style={{ marginTop: 3 }}>
              {session.recipeName} · 第 {session.step + 1} 步
            </AppText>
          </View>
          <AppText size={11} weight="600" color={colors.green}>继续 →</AppText>
        </Pressable>
      ) : null}

      {list.length === 0 ? (
        <View style={styles.empty}>
          <AppText size={13} color={colors.muted} style={{ textAlign: "center" }}>
            {query ? `没有找到「${query}」，换个食材试试？` : "这个分类还没有菜谱，换个分类看看？"}
          </AppText>
          <Pressable
            onPress={() => router.push("/create-recipe")}
            hitSlop={8}
            style={{ marginTop: spacing.md }}
            accessibilityRole="button"
            accessibilityLabel="自己录一道新菜"
          >
            <AppText size={13} weight="600" color={colors.green}>
              没有的话，自己录一道 →
            </AppText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.feed}>
          {columns.map((bucket, index) => (
            <View key={index} style={{ width: columnWidth, gap: GAP }}>
              {bucket.map(renderCard)}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: spacing.lg },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: "#F2F3EA",
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 0 },
  chip: {
    paddingHorizontal: 14,
    height: 32,
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: "#F2F3EA",
  },
  resumeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: spacing.md,
    marginHorizontal: GUTTER,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.greenSoft,
  },
  resumeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.orange },
  feed: {
    flexDirection: "row",
    gap: GAP,
    paddingHorizontal: GUTTER,
    marginTop: spacing.md,
  },
  tile: { width: "100%" },
  tileArt: {
    width: "100%",
    borderRadius: 6,
    backgroundColor: "#F6E9D6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tileTitle: { marginTop: 7, lineHeight: 19, paddingHorizontal: 1 },
  tileMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
    marginBottom: 8,
    paddingHorizontal: 1,
  },
  avatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#B9C4AC",
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { paddingVertical: spacing.xxl, paddingHorizontal: GUTTER, alignItems: "center" },
});
