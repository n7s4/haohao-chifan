import React, { useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
} from "react-native-reanimated";

import { AppText, usePressScale } from "./Common";
import { FoodArt } from "./FoodArt";
import { CheckIcon } from "./Icons";
import { guestBackupFileName, guestBackupLabel, saveJsonFile } from "../lib/exportFile";
import { useStore } from "../state/store";
import { colors, motion, radius, shadow, spacing } from "../theme";

export type GuestMergeCounts = { planCount: number; favoriteCount: number; manualCount: number };

/**
 * 登录时如果本机有「游客态改过、账号还不知道」的内容，问一次要不要并进账号。
 * 用底部选择卡而不是系统 Alert：计数和第三个选项在 Android 的 Alert 里放不下。
 * 点蒙层不关闭——必须明确选一个，避免误触后这批改动被搁置而无人知情。
 */
export function GuestMergePrompt() {
  const { guestMerge, resolveGuestMerge, exportGuestBackup } = useStore();

  // Android 返回键 / 侧滑返回走「先不并」这条安全分支：既不误并入，也不会让卡片
  // 消失得不明不白（那样这批游客改动就被永久搁置了，用户还以为已经处理过）。
  useEffect(() => {
    if (Platform.OS !== "android" || !guestMerge) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      resolveGuestMerge(false);
      return true;
    });
    return () => subscription.remove();
  }, [guestMerge, resolveGuestMerge]);

  if (!guestMerge) return null;

  // 导出游客那份，不是账号那份；导出后卡片不关、不记指纹，下次登录还要再问。
  const doExport = async () => {
    const json = exportGuestBackup();
    if (!json) throw new Error("找不到待并入的游客数据");
    await saveJsonFile(json, guestBackupFileName());
  };

  return (
    <GuestMergeSheet
      counts={guestMerge}
      onMerge={() => resolveGuestMerge(true)}
      onSkip={() => resolveGuestMerge(false)}
      onExport={doExport}
    />
  );
}

export function GuestMergeSheet({
  counts,
  onMerge,
  onSkip,
  onExport,
}: {
  counts: GuestMergeCounts;
  onMerge: () => void;
  onSkip: () => void;
  onExport: () => Promise<void> | void;
}) {
  const insets = useSafeAreaInsets();
  const [backedUp, setBackedUp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tags = [
    counts.planCount ? { key: "plan", text: `${counts.planCount} 个餐位`, bg: colors.accentSoft, fg: colors.accentText } : null,
    counts.favoriteCount ? { key: "fav", text: `${counts.favoriteCount} 个收藏`, bg: colors.sunSoft, fg: colors.sunText } : null,
    counts.manualCount ? { key: "manual", text: `${counts.manualCount} 条采购`, bg: colors.leafSoft, fg: colors.leafText } : null,
  ].filter((tag): tag is NonNullable<typeof tag> => tag !== null);

  const doExport = async () => {
    if (backedUp) return;
    setError(null);
    try {
      await onExport();
      // 分享面板被取消不算失败：能走到这里就是文件已在系统里落地过。
      setBackedUp(guestBackupLabel());
    } catch (failure) {
      setError(`备份没保存成功，可以稍后重试（${(failure as Error).message}）`);
    }
  };

  return (
    <Animated.View style={styles.backdrop} entering={backdropIn} exiting={backdropOut}>
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        entering={sheetIn}
        exiting={sheetOut}
        accessibilityViewIsModal
      >
        <View style={styles.handle} />
        {error ? (
          <Animated.View entering={FadeIn.duration(motion.duration.base)} style={styles.error}>
            <AppText size={13} weight="600" color={colors.danger} style={{ lineHeight: 19 }}>
              {error}
            </AppText>
          </Animated.View>
        ) : null}

        <View style={styles.head}>
          <View style={styles.art}>
            <FoodArt kind="rice" size={56} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText size={21} weight="800" style={{ lineHeight: 27 }}>本机有一份未登录时的改动</AppText>
            <AppText size={13} color={colors.muted} style={styles.hint}>
              并入后会推送到当前账号，原游客副本保留在本机。
            </AppText>
          </View>
        </View>

        <View style={styles.tags}>
          {tags.length ? (
            tags.map((tag) => (
              <View key={tag.key} style={[styles.tag, { backgroundColor: tag.bg }]}>
                <AppText size={13} weight="700" color={tag.fg}>{tag.text}</AppText>
              </View>
            ))
          ) : (
            <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
              <AppText size={13} weight="700" color={colors.muted}>若干内容</AppText>
            </View>
          )}
        </View>

        <SheetButton label="并入当前账号" onPress={onMerge} tone="primary" />
        <SheetButton label="先不并" onPress={onSkip} tone="soft" />

        <Pressable
          style={({ pressed }) => [styles.textRow, pressed && { opacity: 0.6 }]}
          onPress={doExport}
          disabled={Boolean(backedUp)}
          accessibilityRole="button"
          accessibilityLabel={backedUp ? "已备份到本机" : "先导出备份"}
        >
          {backedUp ? (
            <Animated.View entering={ZoomIn.springify().damping(motion.spring.damping)} style={styles.doneDot}>
              <CheckIcon color={colors.white} size={12} />
            </Animated.View>
          ) : null}
          <AppText size={14} weight="700" color={backedUp ? colors.leafText : colors.accentText}>
            {backedUp ? "已备份到本机" : "先导出备份"}
          </AppText>
        </Pressable>

        {backedUp ? (
          <Animated.View entering={FadeIn.duration(motion.duration.base)}>
            <AppText size={12} color={colors.muted} style={styles.note}>{backedUp}</AppText>
            <AppText size={12} color={colors.muted} style={styles.note}>
              文件在系统下载 / 文件 App 里，也可以稍后再并入。
            </AppText>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

function SheetButton({
  label,
  onPress,
  tone,
}: {
  label: string;
  onPress: () => void;
  tone: "primary" | "soft";
}) {
  const press = usePressScale();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.buttonHost}
    >
      <Animated.View style={[styles.button, tone === "primary" ? styles.primary : styles.soft, press.style]}>
        <AppText size={16} weight="700" color={tone === "primary" ? colors.white : colors.ink}>{label}</AppText>
      </Animated.View>
    </Pressable>
  );
}

// 蒙层淡入，底部卡片从下方滑上来（设计稿 sheet 的 ease-out）。跟随系统「减少动态效果」。
const backdropIn = FadeIn.duration(motion.duration.base);
const backdropOut = FadeOut.duration(motion.duration.fast);
const sheetIn = SlideInDown.duration(motion.duration.slow).easing(Easing.bezier(0.22, 1, 0.36, 1));
const sheetOut = SlideOutDown.duration(motion.duration.base);

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(23,31,46,0.4)",
    justifyContent: "flex-end",
    zIndex: 60,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xl,
    paddingTop: 10,
    ...shadow.floating,
  },
  handle: {
    width: Platform.OS === "android" ? 32 : 36,
    height: Platform.OS === "android" ? 4 : 5,
    borderRadius: 3,
    backgroundColor: Platform.OS === "android" ? colors.placeholder : colors.border,
    alignSelf: "center",
    marginTop: Platform.OS === "android" ? 6 : 0,
    marginBottom: spacing.lg,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  art: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: colors.sunSoft,
    alignItems: "center", justifyContent: "center",
    transform: [{ rotate: "-6deg" }],
  },
  hint: { marginTop: 4, lineHeight: 19 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  tag: { height: 28, paddingHorizontal: 10, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  buttonHost: { marginTop: spacing.sm },
  button: {
    minHeight: 54,
    borderRadius: Platform.OS === "android" ? radius.pill : 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  soft: { backgroundColor: colors.surfaceAlt },
  textRow: {
    marginTop: spacing.xs,
    minHeight: 48,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  doneDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.leaf,
    alignItems: "center", justifyContent: "center",
  },
  error: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  note: { textAlign: "center", lineHeight: 18 },
});
