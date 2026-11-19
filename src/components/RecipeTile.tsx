import { router } from "expo-router";
import React, { useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";

import { AppText } from "./Common";
import { FoodArt } from "./FoodArt";
import { HeartIcon } from "./Icons";
import type { Recipe } from "../data/recipes";
import { colors } from "../theme";

/** 「一张一块色」：插图底色在番茄 / 阳光 / 叶子 / 天空四种浅底之间轮换，不要一片同色。 */
export const ART_TINTS = [colors.accentSoft, colors.sunSoft, colors.leafSoft, colors.skySoft];

/**
 * 没有真实封面时的插图高度档位，按位置循环而不是按 id hash——hash 在 30 道内置菜上
 * 会撞成一片同高，瀑布流就退化成规整网格。
 */
export function artHeightFor(
  index: number,
  columnWidth: number,
  min = 130,
  max = 280
): number {
  const ratios = [1.0, 1.28, 0.9, 1.16, 1.0, 1.28];
  const width = columnWidth * ratios[index % ratios.length];
  return Math.round(Math.min(Math.max(width, min), max));
}

/** 有真实封面就按它自己的宽高算卡高——错落感来自图片比例，不是循环档位。 */
export function coverHeightFor(
  cover: { width?: number; height?: number } | undefined,
  index: number,
  columnWidth: number,
  min = 130,
  max = 280
): number {
  if (!cover?.width || !cover?.height) return artHeightFor(index, columnWidth, min, max);
  const ratio = Math.min(cover.height / cover.width, 1.28);
  return Math.round(Math.min(Math.max(columnWidth * ratio, min), max));
}

/** 两列贪心分配：短卡去短的那列，避免一边长一边空。 */
export function splitColumns<T>(
  items: T[],
  measure: (item: T, index: number) => number,
  gap: number
): T[][] {
  const heights = [0, 0];
  const buckets: T[][] = [[], []];
  items.forEach((item, index) => {
    const column = heights[0] <= heights[1] ? 0 : 1;
    buckets[column].push(item);
    heights[column] += measure(item, index) + gap;
  });
  return buckets;
}

/**
 * 封面图：加载中/失败时下面一直是占位首字圆，图到了只做 opacity 淡入，
 * 不换节点也不改高度——否则首屏会先按占位排一遍、图到齐再跳一次。
 */
export function CoverImage({ uri, onError }: { uri: string; onError: () => void }) {
  const [opacity] = useState(() => new Animated.Value(0));
  return (
    <Animated.Image
      source={{ uri }}
      style={{ width: "100%", height: "100%", opacity }}
      resizeMode="cover"
      onLoad={() => {
        Animated.timing(opacity, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }).start();
      }}
      onError={onError}
    />
  );
}

type Props = {
  recipe: Recipe;
  /** 封面区高度，由调用方用 coverHeightFor 算好（发现页 130–280，「我的」110–200）。 */
  artHeight: number;
  columnWidth: number;
  coverUri?: string;
  coverFailed?: boolean;
  onCoverError?: () => void;
  /** 传了就用一行 muted 小字代替作者行。 */
  meta?: string;
  titleSize?: number;
  titleLines?: number;
  badge?: string;
  /** 插图底色，调用方按位置轮换；不传就按菜名兜底。 */
  tint?: string;
  showFavorite?: boolean;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  /** 实测高度，给贪心分列用；和渲染结果是同一套尺寸。 */
  extraHeight?: number;
  /** 社区卡片：作者行位置改显 ♥ 点赞数和 💬 评论数。 */
  stats?: { likes: number; comments: number };
  /** 覆盖默认的「进菜谱详情」跳转（社区卡片进 /community/[id]）。 */
  onPress?: () => void;
};

export function RecipeTile({
  recipe,
  artHeight,
  columnWidth,
  coverUri,
  coverFailed,
  onCoverError,
  meta,
  titleSize = 13,
  titleLines = 2,
  badge,
  tint: tintProp,
  showFavorite,
  favorited,
  onToggleFavorite,
  stats,
  onPress,
}: Props) {
  const hasCover = Boolean(recipe.cover);
  const circle = Math.round(Math.min(Math.max(Math.min(columnWidth, artHeight) * 0.6, 78), 128));
  const artSize = recipe.art ? Math.round(Math.min(artHeight, columnWidth) * 0.9) : circle;
  const tint = tintProp ?? (recipe.art === "salad" ? colors.leafSoft : ART_TINTS[Math.abs(recipe.name.length) % ART_TINTS.length]);
  const author = recipe.custom ? "我" : "好好吃饭";

  return (
    <View style={styles.tile}>
      <Pressable
        onPress={onPress ?? (() => router.push(`/recipe/${recipe.id}`))}
        accessibilityRole="button"
        accessibilityLabel={`查看 ${recipe.name}`}
      >
        <View style={[styles.art, { height: artHeight, backgroundColor: tint }]}>
          {hasCover ? (
            <>
              <View style={styles.coverPlaceholder}>
                <View style={{ opacity: 0.5 }}>
                  <FoodArt
                    kind={recipe.art}
                    size={recipe.art ? artSize : Math.round(circle * 0.82)}
                    label={recipe.name}
                  />
                </View>
              </View>
              {coverUri && !coverFailed ? <CoverImage uri={coverUri} onError={onCoverError ?? (() => {})} /> : null}
            </>
          ) : (
            <FoodArt kind={recipe.art} size={artSize} label={recipe.name} />
          )}
          {badge ? (
            <View style={styles.badge}>
              <AppText size={10} weight="600" color={colors.primary}>{badge}</AppText>
            </View>
          ) : null}
        </View>
        <AppText
          size={titleSize}
          weight="600"
          numberOfLines={titleLines}
          style={[styles.title, titleLines >= 2 && { minHeight: titleLines * 19 }]}
        >
          {recipe.name}
        </AppText>
      </Pressable>

      {showFavorite && meta !== undefined ? (
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={6}
          style={({ pressed }) => [styles.heartFloat, pressed && { transform: [{ scale: 0.88 }] }]}
          accessibilityRole="button"
          accessibilityLabel={favorited ? `取消收藏 ${recipe.name}` : `收藏 ${recipe.name}`}
        >
          <HeartIcon size={17} filled={favorited} color={favorited ? colors.accent : colors.muted} />
        </Pressable>
      ) : null}

      {meta !== undefined ? (
        <AppText size={12} color={colors.muted} numberOfLines={1} style={styles.meta}>
          {meta}
        </AppText>
      ) : stats ? (
        <View style={styles.authorRow}>
          <HeartIcon size={13} color={colors.muted} />
          <AppText size={11.5} color={colors.muted}>{stats.likes}</AppText>
          <AppText size={11.5} color={colors.muted} style={{ marginLeft: 6 }}>{`💬 ${stats.comments}`}</AppText>
        </View>
      ) : (
        <View style={styles.authorRow}>
          {showFavorite ? (
            <>
              <View style={styles.avatar}>
                <AppText size={9} weight="700" color={colors.canvas}>{author.slice(0, 1)}</AppText>
              </View>
              <AppText size={11} color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>{author}</AppText>
              <Pressable
                onPress={onToggleFavorite}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={favorited ? "取消收藏" : "收藏菜谱"}
              >
                <HeartIcon size={14} filled={favorited} color={favorited ? colors.accent : colors.muted} />
              </Pressable>
            </>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: "100%" },
  heartFloat: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  art: {
    width: "100%",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverPlaceholder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 7,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(255,254,250,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { marginTop: 7, lineHeight: 19, paddingHorizontal: 1 },
  meta: { marginTop: 4, marginBottom: 8, paddingHorizontal: 1 },
  authorRow: {
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
    backgroundColor: colors.disabled,
    alignItems: "center",
    justifyContent: "center",
  },
});
