import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "./Common";
import { colors, radius, spacing } from "../theme";

export type ToastState = { text: string; undo?: () => void } | null;

const HOLD_MS = 2200;
const UNDO_HOLD_MS = 5000;

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
    show({ text: "已恢复原来的安排" });
  }, [toast, show]);

  return { toast, show, showText, undo, dismiss };
}

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
    <View style={[styles.toast, { bottom }]} accessibilityLiveRegion="polite">
      <AppText size={12} weight="600" color={colors.cream} numberOfLines={2} style={{ flex: 1 }}>
        {toast.text}
      </AppText>
      {toast.undo ? (
        <Pressable
          onPress={onUndo}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          style={styles.undo}
          accessibilityRole="button"
          accessibilityLabel="撤销替换"
        >
          <AppText size={11} weight="700" color={colors.green}>撤销</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.green,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  undo: {
    width: 54,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
});
