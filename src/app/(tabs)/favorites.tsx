import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Card } from "../../components/Common";
import { FoodArt } from "../../components/FoodArt";
import { HeartIcon } from "../../components/Icons";
import { useStore } from "../../state/store";
import { colors, radius, spacing } from "../../theme";

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const { favorites, toggleFavorite, allRecipes } = useStore();
  const saved = allRecipes.filter((recipe) => favorites.includes(recipe.id));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <AppText size={25} weight="800" style={{ letterSpacing: -0.3 }}>
          我的收藏
        </AppText>
        <AppText size={13} color={colors.muted} style={{ marginTop: 4 }}>
          {saved.length > 0 ? `已经收好 ${saved.length} 道想做的菜` : "还没有收藏，从发现页挑一道吧"}
        </AppText>
      </View>

      <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.xl, gap: spacing.md }}>
        {saved.map((recipe) => (
          <Card key={recipe.id} style={[styles.row, { padding: 0 }]}>
            <Pressable
              onPress={() => router.push(`/recipe/${recipe.id}`)}
              style={styles.rowMain}
              accessibilityRole="button"
              accessibilityLabel={`查看 ${recipe.name}`}
            >
              <View style={[styles.art, recipe.art === "salad" && { backgroundColor: "#EDF0DF" }]}>
                <FoodArt kind={recipe.art} size={62} label={recipe.name} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText size={14} weight="700">{recipe.name}</AppText>
                <AppText size={11} color={colors.muted} style={{ marginTop: 4 }}>
                  {recipe.minutes} 分钟 · {recipe.difficulty} · {recipe.calories} 千卡
                </AppText>
              </View>
            </Pressable>
            <Pressable
              onPress={() => toggleFavorite(recipe.id)}
              hitSlop={10}
              style={styles.rowHeart}
              accessibilityRole="button"
              accessibilityLabel="取消收藏"
            >
              <HeartIcon size={18} filled color={colors.orange} />
            </Pressable>
          </Card>
        ))}

        {saved.length === 0 ? (
          <View style={styles.empty}>
            <AppText size={34}>♡</AppText>
            <AppText size={13} color={colors.muted} style={{ marginTop: 10 }}>
              收藏会出现在这里
            </AppText>
            <Pressable onPress={() => router.push("/")} style={{ marginTop: spacing.lg }}>
              <AppText size={13} weight="600" color={colors.green}>去发现菜谱 →</AppText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  rowHeart: { paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  art: {
    width: 70,
    height: 70,
    borderRadius: radius.md,
    backgroundColor: "#F6E9D6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  empty: { alignItems: "center", paddingVertical: 80 },
});
