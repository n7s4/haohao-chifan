import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "./Common";
import { FoodArt } from "./FoodArt";
import { ChevronRightIcon } from "./Icons";
import { FAT_LOSS_MEALS } from "../data/fatLoss";
import { colors, radius, spacing } from "../theme";

const MAIN_MAX = FAT_LOSS_MEALS.find((m) => m.key === "main")!.maxKcal;

/** 发现页顶部的「减脂餐」专题入口，菜谱和社区两种模式都显示。 */
export function FatLossEntry({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Pressable
      onPress={() => router.push("/fat-loss")}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`减脂餐，${count} 道，每道 ${MAIN_MAX} 千卡以内`}
    >
      <View style={styles.art}>
        <FoodArt kind="salad" size={52} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText size={17} weight="800" color={colors.leafText}>减脂餐</AppText>
        <AppText size={13} color={colors.leafText} style={{ marginTop: 2, opacity: 0.85 }}>
          {count} 道 · 每道 {MAIN_MAX} 千卡以内
        </AppText>
      </View>
      <ChevronRightIcon size={18} color={colors.leafText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: 20,
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.leafSoft,
  },
  art: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
