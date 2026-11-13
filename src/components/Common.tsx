import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { colors, motion, radius, shadow, spacing } from "../theme";

export function AppText({
  children,
  style,
  weight = "400",
  color = colors.ink,
  size = 14,
  numberOfLines,
  maxFontSizeMultiplier = 1.2,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  weight?: "400" | "500" | "600" | "700" | "800";
  color?: string;
  size?: number;
  numberOfLines?: number;
  maxFontSizeMultiplier?: number;
}) {
  // Android 的中文字体（Noto Sans CJK）只有 400 / 700 两档真字重，600 会被机型随机
  // 映射成 bold 或 regular，同一句胶囊字在小米和别家机器上一粗一细。所有 600 在这里
  // 统一收敛到 700，600 只留给纯数字/英文（它们走的是同一套渲染，视觉上够用了）。
  const fontWeight = weight === "600" ? "700" : weight === "500" ? "400" : weight;
  // 设计稿的标题（display）字距收紧：大字号 + 粗字重时略微负字距，正文保持原样。
  const letterSpacing = size >= 20 && (weight === "800" || weight === "700") ? -0.3 : 0.1;
  return (
    <Text
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        // Android 默认给汉字留上下 font padding，行高 1.27 的 30 号标题会把下缘切掉一截。
        { color, fontSize: size, fontWeight, letterSpacing, includeFontPadding: false, textAlignVertical: "center" },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * 按下回弹：按住缩一点，松手用 spring 弹回（对应设计稿 `.btn:active { scale(.96) }`
 * + ease-spring）。系统开了「减少动态效果」时只留透明度变化。
 */
export function usePressScale(pressedScale = 0.96) {
  const reduced = useReducedMotion();
  const press = useSharedValue(0);
  const style = useAnimatedStyle(() => {
    const p = press.get();
    return reduced
      ? { opacity: 1 - p * 0.15 }
      : { transform: [{ scale: 1 - p * (1 - pressedScale) }] };
  });
  const onPressIn = () => {
    press.set(withTiming(1, { duration: 90 }));
  };
  const onPressOut = () => {
    press.set(reduced ? withTiming(0, { duration: motion.duration.fast }) : withSpring(0, motion.spring));
  };
  return { style, onPressIn, onPressOut };
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const press = usePressScale(0.98);
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
    >
      <Animated.View style={[styles.card, style, press.style]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Pill({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const press = usePressScale(0.94);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
    >
      <Animated.View style={[styles.pill, active && styles.pillActive, press.style]}>
        <AppText size={14} color={active ? colors.white : colors.muted} weight="700">
          {label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const press = usePressScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
    >
      <Animated.View style={[styles.primary, disabled && styles.primaryDisabled, style, press.style]}>
        <AppText size={16} weight="700" color={colors.white}>
          {label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const press = usePressScale(0.94);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
    >
      <Animated.View style={[styles.ghost, style, press.style]}>
        {icon}
        <AppText size={14} weight="700" color={colors.ink}>
          {label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow.card,
  },
  pill: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  pillActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  primary: {
    marginHorizontal: spacing.xl,
    minHeight: 54,
    paddingHorizontal: 22,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  primaryDisabled: { opacity: 0.4 },
  ghost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  divider: { height: 1, backgroundColor: colors.border },
});
