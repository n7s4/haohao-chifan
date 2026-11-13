import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown } from "react-native-reanimated";

import { AppText } from "./Common";
import { colors, motion, spacing } from "../theme";

export type ToastState = {
  text: string;
  undo?: () => void;
  /** 点「撤销」之后接着弹的那句；不传时用排餐的默认文案。 */
  undoneText?: string;
} | null;

const HOLD_MS = 2200;
const UNDO_HOLD_MS = 5000;
const DEFAULT_UNDONE_TEXT = "已恢复原来的安排";

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback((next: NonNullable<ToastState>) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), next.undo ? UNDO_HOLD_MS : HOLD_MS);
  }, []);

  const showText = useCallback((text: string) => show({ text }), [show]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const undo = useCallback(() => {
    if (!toast?.undo) return;
    toast.undo();
    show({ text: toast.undoneText ?? DEFAULT_UNDONE_TEXT });
  }, [toast, show]);

  return { toast, show, showText, undo, dismiss };
}

// 设计稿：从下方 30px 处带一点回弹浮上来，退场往下淡出。
// Reanimated 的布局动画默认跟随系统「减少动态效果」，开启时直接出现 / 消失。
const enter = FadeInDown.springify()
  .damping(motion.spring.damping)
  .stiffness(motion.spring.stiffness)
  .mass(motion.spring.mass);
const exit = FadeOutDown.duration(motion.duration.fast);

export function Toast({
  toast,
  bottom,
  onUndo,
}: {
  toast: ToastState;
  bottom: number;
  onUndo: () => void;
}) {
  if (!toast) return null;
  return (
    <Animated.View
      // 换一句话就重新弹一次，连续两条不会像是原地改字。
      key={toast.text}
      entering={enter}
      exiting={exit}
      style={[styles.toast, { bottom }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <AppText size={14.5} weight="500" color={colors.white} numberOfLines={2} style={styles.text}>
        {toast.text}
      </AppText>
      {toast.undo ? (
        <Animated.View entering={FadeIn.delay(120).duration(motion.duration.fast)} exiting={FadeOut.duration(80)}>
          <Pressable
            onPress={onUndo}
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
            style={({ pressed }) => [styles.undo, pressed && styles.undoPressed]}
            accessibilityRole="button"
            accessibilityLabel="撤销"
          >
            <AppText size={14.5} weight="700" color={colors.sun}>撤销</AppText>
          </Pressable>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    minHeight: 52,
    // Android 走 Material snackbar：小圆角、略浅的墨色底。
    backgroundColor: Platform.OS === "android" ? "#252C38" : colors.ink,
    borderRadius: Platform.OS === "android" ? 6 : 16,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: colors.ink,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
    zIndex: 100,
  },
  text: { flex: 1, lineHeight: 20 },
  undo: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  undoPressed: { backgroundColor: "rgba(255,255,255,0.1)" },
});
