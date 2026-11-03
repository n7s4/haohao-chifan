import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Card } from "../../components/Common";
import { FoodArt, WeekDots } from "../../components/FoodArt";
import { ClockIcon, HeartIcon, SearchIcon } from "../../components/Icons";
import { categories, matchesCategory, recipes } from "../../data/recipes";
import { CookSession, loadAnyCookSession } from "../../lib/cookSession";
import { useStore } from "../../state/store";
import { colors, radius, spacing } from "../../theme";

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { favorites, toggleFavorite } = useStore();
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

  const hero = recipes[0];
  const list = useMemo(() => {
    const rest = recipes.filter((recipe) => recipe.id !== hero.id);
    const normalized = query.trim();
    const inCategory = rest.filter((recipe) => matchesCategory(recipe, category));
    if (!normalized) return category === "推荐" ? rest : inCategory;
    return recipes.filter(
      (recipe) =>
        (recipe.name.includes(normalized) ||
          recipe.tags.some((tag) => tag.includes(normalized)) ||
          recipe.ingredients.some((item) => item.name.includes(normalized))) &&
        matchesCategory(recipe, category)
    );
  }, [hero.id, query, category]);

  const isFavorite = favorites.includes(hero.id);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: spacing.xxxl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.brandRow}>
          <AppText size={26} weight="800" style={{ letterSpacing: -0.6 }}>
            好好吃饭
          </AppText>
          <AppText size={11} color={colors.muted} style={{ marginTop: 10 }}>
            每一餐，都值得认真对待
          </AppText>
        </View>
        <AppText
          size={13}
          weight="700"
          color={colors.green}
          style={{ letterSpacing: 1, marginTop: spacing.md }}
        >
          01 / 发现灵感
        </AppText>
        <AppText size={25} weight="800" style={{ marginTop: spacing.sm, letterSpacing: -0.3 }}>
          今天，想吃点什么？
        </AppText>
        <AppText size={13} color={colors.muted} style={{ marginTop: 4 }}>
          从一顿好饭，开始美好的一天
        </AppText>

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
              style={[
                styles.chip,
                category === item && { backgroundColor: colors.green },
              ]}
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

      <Card style={styles.hero} onPress={() => router.push(`/recipe/${hero.id}`)} accessibilityLabel={`查看 ${hero.name}`}>
        <View style={styles.heroArt}>
          <FoodArt kind={hero.art} size={148} />
          <View style={styles.badge}>
            <AppText size={10} weight="600" color={colors.green}>
              本周人气精选
            </AppText>
          </View>
        </View>
        <View style={styles.heroCopy}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <WeekDots count={4} />
            <Pressable
              onPress={() => toggleFavorite(hero.id)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={isFavorite ? "取消收藏" : "收藏菜谱"}
            >
              <HeartIcon color={colors.cream} filled={isFavorite} size={18} />
            </Pressable>
          </View>
          <AppText size={22} weight="800" color={colors.cream} style={{ marginTop: spacing.md, letterSpacing: -0.2 }}>
            {hero.name}
          </AppText>
          <AppText size={11} color="#DCE3D4" style={{ marginTop: 6 }}>
            {hero.minutes} 分钟 · {hero.difficulty} · {hero.calories} 千卡
          </AppText>
          <View style={styles.heroCta}>
            <AppText size={11} weight="600" color={colors.green}>
              开始烹饪
            </AppText>
          </View>
        </View>
      </Card>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <AppText size={17} weight="800" style={{ letterSpacing: -0.2 }}>
            为你推荐
          </AppText>
          <AppText size={12} color={colors.muted}>
            查看全部
          </AppText>
        </View>

        {query && list.length === 0 ? (
          <View style={styles.empty}>
            <AppText size={13} color={colors.muted}>
              {query ? `没有找到「${query}」，换个食材试试？` : `这个分类还没有菜谱，换个分类看看？`}
            </AppText>
          </View>
        ) : null}

        <View style={styles.grid}>
          {list.map((recipe) => {
            const favorited = favorites.includes(recipe.id);
            return (
              <Card
                key={recipe.id}
                style={styles.tile}
                onPress={() => router.push(`/recipe/${recipe.id}`)}
                accessibilityLabel={`查看 ${recipe.name}`}
              >
                <View style={[styles.tileArt, recipe.art === "salad" && { backgroundColor: "#EDF0DF" }]}>
                  <FoodArt kind={recipe.art} size={92} />
                </View>
                <View style={{ padding: spacing.md }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <AppText size={13} weight="700" numberOfLines={1} style={{ flex: 1 }}>
                      {recipe.name}
                    </AppText>
                    <Pressable onPress={() => toggleFavorite(recipe.id)} hitSlop={8} accessibilityLabel="收藏">
                      <HeartIcon size={15} filled={favorited} color={favorited ? colors.orange : colors.muted} />
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                    <ClockIcon size={12} />
                    <AppText size={11} color={colors.muted}>
                      {recipe.minutes} 分钟 · {recipe.difficulty}
                    </AppText>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      </View>

      <Pressable
        style={styles.planBanner}
        onPress={() => router.push("/plan")}
        accessibilityRole="button"
        accessibilityLabel="查看每周菜单"
      >
        <View style={{ flex: 1 }}>
          <AppText size={15} weight="800" color={colors.green}>
            这周吃什么，已经安排好了
          </AppText>
          <AppText size={12} color={colors.muted} style={{ marginTop: 4 }}>
            打开每周菜单，替换菜谱或直接生成采购清单
          </AppText>
        </View>
        <AppText size={18} color={colors.green}>
          →
        </AppText>
      </Pressable>

      <AppText size={11} color={colors.muted} style={{ textAlign: "center", marginTop: spacing.xl }}>
        温暖、清晰、让做饭更轻松
      </AppText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: spacing.xl },
  brandRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: "#F2F3EA",
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 0 },
  chip: {
    paddingHorizontal: 16,
    height: 34,
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: "#F2F3EA",
  },
  resumeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6DCCB",
  },
  resumeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.orange },
  hero: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.xl,
    padding: spacing.xs,
    backgroundColor: colors.green,
    borderWidth: 0,
    overflow: "hidden",
  },
  heroArt: {
    backgroundColor: "#EFE3CF",
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
  },
  badge: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    backgroundColor: colors.cream,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  heroCopy: { padding: spacing.lg },
  heroCta: {
    alignSelf: "flex-start",
    marginTop: spacing.md,
    backgroundColor: colors.cream,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  section: { marginTop: spacing.xxl, paddingHorizontal: spacing.xl },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: {
    width: "48%",
    flexGrow: 1,
    flexBasis: "45%",
    overflow: "hidden",
    padding: 0,
  },
  tileArt: {
    backgroundColor: "#F6E9D6",
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  empty: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },
  planBanner: {
    marginTop: spacing.xxl,
    marginHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.greenSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
});
