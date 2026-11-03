import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "./Common";
import { colors, radius, spacing } from "../theme";

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
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="关闭确认" />
      <View style={styles.dialog} accessibilityViewIsModal>
        <AppText size={16} weight="800">{title}</AppText>
        {message ? (
          <AppText size={12} color={colors.muted} style={{ marginTop: spacing.sm, lineHeight: 19 }}>
            {message}
          </AppText>
        ) : null}
        <View style={styles.actions}>
          <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button" accessibilityLabel={cancelLabel}>
            <AppText size={14} weight="600" color={colors.muted}>{cancelLabel}</AppText>
          </Pressable>
          <Pressable
            style={[styles.confirm, destructive && { backgroundColor: colors.orangeText }]}
            onPress={onConfirm} accessibilityRole="button" accessibilityLabel={confirmLabel}>
            <AppText size={14} weight="700" color={colors.cream}>{confirmLabel}</AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(28,34,24,0.36)",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  dialog: {
    width: "100%", maxWidth: 340,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl },
  cancel: {
    flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.greenSoft,
    alignItems: "center", justifyContent: "center",
  },
  confirm: {
    flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.green,
    alignItems: "center", justifyContent: "center",
  },
});
