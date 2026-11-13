import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";

import { AppText, usePressScale } from "./Common";
import { colors, motion, radius, shadow, spacing } from "../theme";

// 蒙层淡入，卡片带回弹地「啵」一下出来（设计稿 pop 关键帧）。
// 布局动画默认跟随系统「减少动态效果」。
const backdropIn = FadeIn.duration(motion.duration.base);
const backdropOut = FadeOut.duration(motion.duration.fast);
const dialogIn = ZoomIn.springify()
  .damping(motion.spring.damping)
  .stiffness(motion.spring.stiffness)
  .mass(motion.spring.mass);
const dialogOut = ZoomOut.duration(motion.duration.fast);

export function ConfirmDialog({
  title,
  message,
  cancelLabel = "取消",
  confirmLabel,
  onCancel,
  onConfirm,
  destructive = false,
}: {
  title: string;
  message?: string;
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <Animated.View style={styles.backdrop} entering={backdropIn} exiting={backdropOut}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="关闭确认" />
      <Animated.View
        style={styles.dialog}
        entering={dialogIn}
        exiting={dialogOut}
        accessibilityViewIsModal
        accessibilityRole="alert"
      >
        {destructive ? (
          <View style={styles.badge}>
            <AppText size={24} weight="800" color={colors.danger}>!</AppText>
          </View>
        ) : null}
        <AppText size={19} weight="800" style={styles.title}>{title}</AppText>
        {message ? (
          <AppText size={14} color={colors.muted} style={styles.message}>
            {message}
          </AppText>
        ) : null}
        <View style={styles.actions}>
          <DialogButton label={cancelLabel} onPress={onCancel} tone="soft" />
          <DialogButton label={confirmLabel} onPress={onConfirm} tone={destructive ? "danger" : "dark"} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function DialogButton({
  label,
  onPress,
  tone,
}: {
  label: string;
  onPress: () => void;
  tone: "soft" | "dark" | "danger";
}) {
  const press = usePressScale();
  return (
    <Pressable
      style={styles.buttonHost}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View
        style={[
          styles.button,
          tone === "soft" && { backgroundColor: colors.surfaceAlt },
          tone === "dark" && { backgroundColor: colors.ink },
          tone === "danger" && { backgroundColor: colors.danger },
          press.style,
        ]}
      >
        <AppText size={15} weight="700" color={tone === "soft" ? colors.ink : colors.white}>
          {label}
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(23,31,46,0.4)",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.xl,
    zIndex: 90,
  },
  dialog: {
    width: "100%", maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    paddingTop: spacing.xl + 2,
    ...shadow.floating,
  },
  badge: {
    width: 48, height: 48, borderRadius: 16,
    backgroundColor: colors.accentSoft,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
    transform: [{ rotate: "-6deg" }],
  },
  title: { lineHeight: 25 },
  message: { marginTop: spacing.sm, lineHeight: 21 },
  actions: { flexDirection: "row", gap: 10, marginTop: spacing.xl },
  buttonHost: { flex: 1 },
  button: {
    minHeight: 50, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
});
