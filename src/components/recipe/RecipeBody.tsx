import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { AppText } from "../Common";
import { CheckIcon, ClockIcon, PlusIcon } from "../Icons";
import { type Recipe, cookingIngredients, seasoningIngredients } from "../../data/recipes";
import type { StepImage } from "../../lib/steps";
import { colors, motion, radius, shadow, spacing } from "../../theme";

/** 分段入场：每块晚 60ms 从下方浮上来（设计稿 .rise）。 */
export const rise = (i: number) =>
  FadeInDown.delay(60 + i * 60).duration(motion.duration.slow).easing(Easing.out(Easing.cubic));

const formatQty = (n: number) => `${Number(n.toFixed(n < 1 ? 2 : 1))}`;

/**
 * 菜谱正文：食材（含份量调节、勾选）/ 调料 / 步骤 / 小提示。只管展示；
 * 份量、勾选状态和点图看大图都由页面传入——私有菜详情和社区菜详情共用。
 */
export function RecipeBody({
  recipe,
  imageUri,
  servings,
  onAdjustServings,
  checked,
  onToggleIngredient,
  onPressImage,
}: {
  recipe: Recipe;
  imageUri: (image: StepImage) => string | null;
  servings: number;
  onAdjustServings: (delta: number) => void;
  checked: Record<number, boolean>;
  onToggleIngredient: (index: number) => void;
  onPressImage: (image: StepImage) => void;
}) {
  // 步骤图按像素算尺寸：`width: "47%"` + aspectRatio 在安卓（Yoga，换行 row）里高度算成 0，
  // 占了位却看不见（2026-11 真机 onLayout 实测 147×0）。
  const [photoRowWidth, setPhotoRowWidth] = useState(0);
  const stepPhotoWidth = photoRowWidth > 0 ? Math.floor((photoRowWidth - spacing.sm) / 2) : 0;
  const stepPhotoSize = stepPhotoWidth
    ? { width: stepPhotoWidth, height: Math.round((stepPhotoWidth * 3) / 4) }
    : { width: "47%" as const, height: 110 };
  const factor = servings / 1;
  const seasonings = useMemo(() => seasoningIngredients(recipe), [recipe]);
  const ingredients = useMemo(
    () =>
      cookingIngredients(recipe).map((item) => ({
        ...item,
        display: item.qty === null ? item.unit : `${formatQty(item.qty * factor)} ${item.unit}`,
      })),
    [recipe, factor]
  );
  const stepMinutes = recipe.stepMinutes ?? [];
  const totalStepMinutes = recipe.steps.reduce((sum, _, index) => sum + (stepMinutes[index] ?? 0), 0);
  const tip = recipe.tips?.[0];

  return (
    <>
      <Animated.View entering={rise(3)}>
        <View style={styles.blockHead}>
          <AppText size={20} weight="800" style={{ letterSpacing: -0.3 }}>食材</AppText>
          <View style={styles.stepper} accessibilityLabel="份量">
            <StepperButton
              label="减少份量"
              disabled={servings <= 1}
              onPress={() => onAdjustServings(-1)}
            >
              <MinusIcon size={18} color={colors.ink} />
            </StepperButton>
            <AppText size={17} weight="800" style={styles.stepperValue}>
              {servings} 人
            </AppText>
            <StepperButton
              label="增加份量"
              disabled={servings >= 6}
              onPress={() => onAdjustServings(1)}
            >
              <PlusIcon size={18} color={colors.ink} />
            </StepperButton>
          </View>
        </View>

        {ingredients.length ? (
          <View style={styles.card}>
            {ingredients.map((item, index) => (
              <IngredientRow
                key={`${item.name}-${index}`}
                name={item.name}
                display={item.display}
                checked={Boolean(checked[index])}
                last={index === ingredients.length - 1}
                onToggle={() => onToggleIngredient(index)}
              />
            ))}
          </View>
        ) : null}

        {seasonings.length ? (
          <>
            <AppText size={15} weight="800" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
              调料
            </AppText>
            <View style={styles.card}>
              {seasonings.map((item, index) => (
                <View
                  key={`${item.name}-${index}`}
                  style={[styles.seasonRow, index === seasonings.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={styles.seasonDot} />
                  <AppText size={15} weight="500" style={{ flex: 1 }}>
                    {item.name}
                  </AppText>
                  <Qty
                    text={item.qty === null ? item.unit : `${formatQty(item.qty * factor)} ${item.unit}`}
                    muted
                  />
                </View>
              ))}
            </View>
          </>
        ) : null}
      </Animated.View>

      <Animated.View entering={rise(4)}>
        <View style={styles.blockHead}>
          <AppText size={20} weight="800" style={{ letterSpacing: -0.3 }}>步骤</AppText>
          <AppText size={13} color={colors.muted}>
            {recipe.steps.length} 步{totalStepMinutes > 0 ? ` · 约 ${totalStepMinutes} 分钟` : ""}
          </AppText>
        </View>
        {recipe.steps.map((step, index) => (
          <View key={index} style={styles.stepRow}>
            <View style={styles.stepRail}>
              <View style={styles.stepIndex}>
                <AppText size={15} weight="800" color={colors.sunText}>
                  {index + 1}
                </AppText>
              </View>
              {index < recipe.steps.length - 1 ? <View style={styles.stepLine} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 18 }}>
              <AppText size={15.5} style={{ lineHeight: 25 }} color={colors.ink}>
                {step.text}
              </AppText>
              {stepMinutes[index] ? (
                <View style={styles.stepMeta}>
                  <ClockIcon size={14} color={colors.muted} />
                  <AppText size={12.5} color={colors.muted}>
                    约 {stepMinutes[index]} 分钟
                  </AppText>
                </View>
              ) : null}
              {step.images?.length ? (
                <View
                  style={styles.stepPhotos}
                  onLayout={(event) => setPhotoRowWidth(event.nativeEvent.layout.width)}
                >
                  {step.images.map((image) => {
                    const uri = imageUri(image);
                    return uri ? (
                      <Pressable
                        key={image.id}
                        onPress={() => onPressImage(image)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel="查看步骤大图"
                        style={[styles.stepPhoto, stepPhotoSize]}
                      >
                        <Image
                          alt="步骤配图"
                          source={{ uri }}
                          style={StyleSheet.absoluteFill}
                          resizeMode="cover"
                        />
                      </Pressable>
                    ) : null;
                  })}
                </View>
              ) : null}
            </View>
          </View>
        ))}
        {tip ? (
          <View style={styles.tipBox}>
            <AppText size={14} color={colors.leafText} style={{ lineHeight: 21 }}>
              <AppText size={14} weight="800" color={colors.leafText}>小提示</AppText>
              {"　"}
              {tip}
            </AppText>
          </View>
        ) : null}
      </Animated.View>
    </>
  );
}

function StepperButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.stepperBtn,
        pressed && { backgroundColor: colors.surface },
        disabled && { opacity: 0.35 },
      ]}
    >
      {children}
    </Pressable>
  );
}

function IngredientRow({
  name,
  display,
  checked,
  last,
  onToggle,
}: {
  name: string;
  display: string;
  checked: boolean;
  last: boolean;
  onToggle: () => void;
}) {
  const on = useSharedValue(checked ? 1 : 0);
  useEffect(() => {
    on.set(withSpring(checked ? 1 : 0, motion.spring));
  }, [checked, on]);
  const circle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [colors.surface, colors.leaf]),
    borderColor: interpolateColor(on.value, [0, 1], [colors.border, colors.leaf]),
    transform: [{ scale: 1 + on.value * 0.08 }],
  }));
  const tick = useAnimatedStyle(() => ({
    opacity: on.value,
    transform: [{ scale: 0.4 + on.value * 0.6 }],
  }));
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.ingRow, last && { borderBottomWidth: 0 }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${name} ${display}`}
    >
      <Animated.View style={[styles.check, circle]}>
        <Animated.View style={tick}>
          <CheckIcon size={14} color={colors.white} />
        </Animated.View>
      </Animated.View>
      <AppText
        size={15}
        weight="500"
        color={checked ? colors.placeholder : colors.ink}
        style={[{ flex: 1 }, checked && { textDecorationLine: "line-through" }]}
      >
        {name}
      </AppText>
      <Qty text={display} muted={checked} />
    </Pressable>
  );
}

/** 份量一变，数字从上方弹下来（设计稿 .q.tick）；首帧不动。 */
function Qty({ text, muted }: { text: string; muted?: boolean }) {
  const t = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    t.set(0);
    t.set(withSpring(1, motion.spring));
  }, [text, t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.6], [0, 1], "clamp"),
    transform: [{ translateY: (1 - t.value) * -8 }],
  }));
  return (
    <Animated.View style={style}>
      <AppText size={15} weight="700" color={muted ? colors.placeholder : colors.ink} style={{ fontVariant: ["tabular-nums"] }}>
        {text}
      </AppText>
    </Animated.View>
  );
}

function MinusIcon({ color = colors.ink, size = 16 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  blockHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    padding: 3,
  },
  stepperBtn: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  stepperValue: { minWidth: 44, textAlign: "center", fontVariant: ["tabular-nums"] },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    ...shadow.card,
  },
  ingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 54,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  seasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 50,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  seasonDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sun, marginHorizontal: 9 },
  stepRow: { flexDirection: "row", gap: spacing.md },
  stepRail: { width: 34, alignItems: "center" },
  stepIndex: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.sunSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  // 单边虚线在 iOS 上画不出来，用 0 宽 + 四边虚线收成一条竖虚线。
  stepLine: {
    flex: 1,
    width: 0,
    marginTop: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
  stepMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  stepPhotos: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  stepPhoto: { borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.track },
  tipBox: {
    backgroundColor: colors.leafSoft,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    marginTop: 4,
  },
});
