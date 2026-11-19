import React from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeIn, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../Common";
import type { ReportReason } from "../../lib/community/api";
import { colors, motion, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";

const backdropIn = FadeIn.duration(motion.duration.base);
const sheetIn = SlideInDown.duration(motion.duration.slow).easing(Easing.bezier(0.22, 1, 0.36, 1));

export type SheetAction = { label: string; onPress: () => void; danger?: boolean };

/** 通用底部操作弹层：一列操作 + 取消。详情页「…」菜单、长按评论等共用。 */
export function ActionSheet({
  title,
  hint,
  actions,
  onCancel,
}: {
  title?: string;
  hint?: string;
  actions: SheetAction[];
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="none" visible onRequestClose={onCancel}>
      <Animated.View entering={backdropIn} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="关闭" />
        <Animated.View
          entering={sheetIn}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
          accessibilityViewIsModal
        >
          <View style={styles.grab} />
          {title ? (
            <AppText size={18} weight="800" style={styles.title}>
              {title}
            </AppText>
          ) : null}
          {hint ? (
            <AppText size={13} color={colors.muted} style={styles.hint}>
              {hint}
            </AppText>
          ) : null}
          <View style={title || hint ? { marginTop: spacing.md } : null}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={action.onPress}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <AppText size={16} weight="700" color={action.danger ? colors.danger : colors.ink}>
                  {action.label}
                </AppText>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onCancel} style={styles.cancel} accessibilityRole="button" accessibilityLabel="取消">
            <AppText size={15} weight="700" color={colors.muted}>
              取消
            </AppText>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export const REPORT_REASONS: [ReportReason, string][] = [
  ["ad", "广告"],
  ["unfriendly", "不友善"],
  ["irrelevant", "不相关"],
  ["other", "其他"],
];

/** 举报原因弹层：选一个原因即回调，由调用方关闭弹层并提交。菜和评论共用。 */
export function ReportSheet({
  title = "举报",
  onSelect,
  onCancel,
}: {
  title?: string;
  onSelect: (reason: ReportReason) => void;
  onCancel: () => void;
}) {
  return (
    <ActionSheet
      title={title}
      hint="选一个原因，我们会尽快处理"
      actions={REPORT_REASONS.map(([reason, label]) => ({ label, onPress: () => onSelect(reason) }))}
      onCancel={onCancel}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(23,31,46,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    ...shadow.floating,
  },
  grab: {
    width: IS_ANDROID ? 32 : 36,
    height: IS_ANDROID ? 4 : 5,
    borderRadius: 3,
    backgroundColor: IS_ANDROID ? colors.placeholder : colors.border,
    alignSelf: "center",
    marginTop: IS_ANDROID ? 6 : 0,
    marginBottom: 14,
  },
  title: { letterSpacing: -0.3 },
  hint: { marginTop: 4, lineHeight: 19 },
  row: {
    minHeight: 54,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cancel: {
    marginTop: spacing.md,
    minHeight: 50,
    borderRadius: IS_ANDROID ? radius.pill : 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
});
