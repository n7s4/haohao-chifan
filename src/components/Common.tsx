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

import { colors, radius, spacing } from "../theme";

export function AppText({
  children,
  style,
  weight = "400",
  color = colors.ink,
  size = 14,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  weight?: "400" | "500" | "600" | "700" | "800";
  color?: string;
  size?: number;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ color, fontSize: size, fontWeight: weight, letterSpacing: 0.1 }, style]}
    >
      {children}
    </Text>
  );
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
  const content = <View style={[styles.card, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.9 } : undefined)}
    >
      {content}
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        active && { backgroundColor: colors.green },
        pressed && { opacity: 0.85 },
      ]}
    >
      <AppText size={13} color={active ? colors.cream : colors.muted} weight={active ? "600" : "400"}>
        {label}
      </AppText>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.88 },
        style,
      ]}
    >
      <AppText size={16} weight="700" color={colors.cream}>
        {label}
      </AppText>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.8 }, style]}
    >
      {icon}
      <AppText size={13} weight="600" color={colors.green}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
  },
  primary: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.orangeText,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: spacing.xl,
  },
  ghost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
  },
  divider: { height: 1, backgroundColor: colors.line },
});
