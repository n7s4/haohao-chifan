import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddToPlanSheet } from "../../components/AddToPlanSheet";
import { AppText, Divider } from "../../components/Common";
import { FoodArt } from "../../components/FoodArt";
import { BackIcon, CheckIcon, HeartIcon, PlusIcon } from "../../components/Icons";
import { Toast, useToast } from "../../components/Toast";
import {
  cookingIngredients,
  recipeDifficulty,
  recipeMinutes,
  recipeSubtitle,
  seasoningIngredients,
} from "../../data/recipes";
import { useStore } from "../../state/store";
import { colors, radius, spacing } from "../../theme";

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { favorites, toggleFavorite, servings: servingsMap, setServings, ratings, findRecipe } = useStore();
  const recipe = findRecipe(id);
  const myRating = ratings[recipe?.id ?? ""] ?? 0;
  const servings = servingsMap[recipe?.id ?? ""] ?? 1;
  const adjustServings = (delta: number) => {
    if (recipe) setServings(recipe.id, servings + delta);
  };
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [addingToPlan, setAddingToPlan] = useState(false);
  const { toast, show, undo: undoReplace } = useToast();

  const factor = servings / 1;
  const seasonings = useMemo(() => (recipe ? seasoningIngredients(recipe) : []), [recipe]);
  const ingredients = useMemo(
    () =>
      (recipe ? cookingIngredients(recipe) : []).map((item) => ({
        ...item,
        display:
          item.qty === null
            ? item.unit
            : `${Number((item.qty * factor).toFixed(2))} ${item.unit}`,
      })),
    [recipe, factor]
  );

  if (!recipe) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 40, paddingHorizontal: 24 }]}>
        <AppText size={16} weight="700">没有找到这道菜</AppText>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <AppText size={14} color={colors.green}>返回</AppText>
        </Pressable>
      </View>
    );
  }

  const isFavorite = favorites.includes(recipe.id);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroWrap}>
          <View style={[styles.hero, recipe.art === "salad" && { backgroundColor: "#EDF0DF" }]}>
            <FoodArt kind={recipe.art} size={200} label={recipe.name} />
          </View>
          <View style={[styles.heroTop, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable
              onPress={() => router.back()}
              style={styles.roundButton}
              accessibilityRole="button"
              accessibilityLabel="返回"
              hitSlop={8}
            >
              <BackIcon size={18} />
            </Pressable>
            <Pressable
              onPress={() => toggleFavorite(recipe.id)}
              style={styles.roundButton}
              accessibilityRole="button"
              accessibilityLabel={isFavorite ? "取消收藏" : "收藏"}
              hitSlop={8}
            >
              <HeartIcon size={18} filled={isFavorite} color={isFavorite ? colors.orange : colors.green} />
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText size={24} weight="800" style={{ letterSpacing: -0.3, flexShrink: 1 }}>
              {recipe.name}
            </AppText>
            {recipe.custom ? (
              <Pressable
                onPress={() => router.push({ pathname: "/create-recipe", params: { id: recipe.id } })}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="编辑这道菜"
              >
                <AppText size={13} weight="600" color={colors.green}>编辑</AppText>
              </Pressable>
            ) : null}
          </View>
          <AppText size={13} color={colors.muted} style={{ marginTop: 6, lineHeight: 20 }}>
            {recipeSubtitle(recipe)}
          </AppText>

          <View style={styles.stats}>
            {[
              { value: recipeMinutes(recipe), label: "烹饪时间" },
              { value: recipeDifficulty(recipe), label: "难易程度" },
              { value: myRating ? `${myRating} 星` : "—", label: "我的评分" },
            ].map((item) => (
              <View key={item.label} style={styles.statCell}>
                <AppText size={13} weight="700" color={colors.green}>
                  {item.value}
                </AppText>
                <AppText size={10} color={colors.muted} style={{ marginTop: 2 }}>
                  {item.label}
                </AppText>
              </View>
            ))}
          </View>

          <View style={styles.sectionHead}>
            <AppText size={16} weight="800">
              准备食材
            </AppText>
            <View style={styles.servings}>
              <Pressable
                onPress={() => adjustServings(-1)}
                style={styles.servingBtn}
                accessibilityLabel="减少份量"
                hitSlop={6}
              >
                <AppText size={14} weight="700" color={colors.green}>
                  −
                </AppText>
              </Pressable>
              <AppText size={12} weight="600" color={colors.green} style={{ minWidth: 40, textAlign: "center" }}>
                {servings} 人份
              </AppText>
              <Pressable
                onPress={() => adjustServings(1)}
                style={styles.servingBtn}
                accessibilityLabel="增加份量"
                hitSlop={6}
              >
                <PlusIcon size={12} />
              </Pressable>
            </View>
          </View>

          <View style={{ marginTop: spacing.sm }}>
            {ingredients.map((item, index) => (
              <Pressable
                key={`${item.name}-${index}`}
                onPress={() => setDone((current) => ({ ...current, [index]: !current[index] }))}
                style={styles.ingredientRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: Boolean(done[index]) }}
              >
                <View style={[styles.checkbox, done[index] && { backgroundColor: colors.green, borderColor: colors.green }]}>
                  {done[index] ? <CheckIcon size={11} /> : null}
                </View>
                <AppText
                  size={13}
                  color={done[index] ? colors.muted : colors.ink}
                  style={[{ flex: 1, marginLeft: 10 }, done[index] && { textDecorationLine: "line-through" }]}
                >
                  {item.name}
                </AppText>
                <AppText size={12} color={colors.muted}>
                  {item.display}
                </AppText>
              </Pressable>
            ))}
          </View>

          {seasonings.length ? (
            <>
              <AppText size={13} weight="700" style={{ marginTop: spacing.lg }}>
                调料
              </AppText>
              <View style={{ marginTop: spacing.sm }}>
                {seasonings.map((item, index) => (
                  <View key={`${item.name}-${index}`} style={styles.ingredientRow}>
                    <AppText size={13} style={styles.seasoningName} color={colors.ink}>
                      {item.name}
                    </AppText>
                    <AppText size={12} color={colors.muted}>
                      {item.qty === null ? item.unit : `${Number((item.qty * factor).toFixed(2))} ${item.unit}`}
                    </AppText>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Divider style={{ marginVertical: spacing.lg }} />

          <AppText size={16} weight="800">
            烹饪步骤
          </AppText>
          <View style={{ marginTop: spacing.md }}>
            {recipe.steps.map((step, index) => (
              <View key={index} style={styles.stepRow}>
                <View style={styles.stepIndex}>
                  <AppText size={11} weight="700" color={colors.green}>
                    {`${index + 1}`.padStart(2, "0")}
                  </AppText>
                </View>
                <AppText size={13} style={{ flex: 1, lineHeight: 21 }} color={colors.ink}>
                  {step.text}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={styles.planButton}
          onPress={() => setAddingToPlan(true)}
          accessibilityRole="button"
          accessibilityLabel="加入菜单"
        >
          <PlusIcon size={15} color={colors.green} />
          <AppText size={14} weight="600" color={colors.green}>
            加入菜单
          </AppText>
        </Pressable>
        <Pressable
          style={styles.cookButton}
          onPress={() => router.push(`/cook/${recipe.id}`)}
          accessibilityRole="button"
          accessibilityLabel="开始烹饪"
        >
          <AppText size={16} weight="700" color={colors.cream}>
            开始烹饪
          </AppText>
          <AppText size={16} weight="700" color={colors.cream}>
            →
          </AppText>
        </Pressable>
      </View>

      <Toast toast={toast} bottom={insets.bottom + 96} onUndo={undoReplace} />

      {addingToPlan ? (
        <AddToPlanSheet
          recipeId={recipe.id}
          onClose={() => setAddingToPlan(false)}
          onDone={(message, undo) => {
            setAddingToPlan(false);
            show(undo ? { text: message, undo } : { text: message });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  heroWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  hero: {
    borderRadius: radius.xl,
    backgroundColor: "#F0EBDD",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
  },
  heroTop: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  roundButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,254,250,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  stats: {
    flexDirection: "row",
    backgroundColor: "#F2F3EA",
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  statCell: { flex: 1, alignItems: "center" },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xxl,
    marginBottom: spacing.xs,
  },
  servings: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.greenSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 2,
  },
  servingBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.4,
    borderColor: "#C9CEBB",
    alignItems: "center",
    justifyContent: "center",
  },
  seasoningName: { flex: 1, paddingLeft: 28 },
  stepRow: { flexDirection: "row", gap: spacing.md, paddingVertical: 9 },
  stepIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.cream,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  planButton: {
    height: 54,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  cookButton: {
    flex: 1,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.orangeText,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
});
