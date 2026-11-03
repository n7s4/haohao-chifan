import React, { useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "./Common";
import { guestBackupFileName, guestBackupLabel, saveJsonFile } from "../lib/exportFile";
import { useStore } from "../state/store";
import { colors, radius, spacing } from "../theme";

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

  const parts = [
    counts.planCount ? `${counts.planCount} 个餐位` : "",
    counts.favoriteCount ? `${counts.favoriteCount} 个收藏` : "",
    counts.manualCount ? `${counts.manualCount} 条采购` : "",
  ].filter(Boolean);

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
    <View style={styles.backdrop}>
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        accessibilityViewIsModal
      >
        <View style={styles.handle} />
        {error ? (
          <AppText size={13} weight="600" color={colors.orangeText} style={styles.error}>
            {error}
          </AppText>
        ) : null}
        <AppText size={16} weight="800">本机有一份未登录时的改动</AppText>
        <AppText size={13} weight="600" color={colors.green} style={styles.counts}>
          {parts.join(" · ") || "若干内容"}
        </AppText>
        <AppText size={11} color={colors.muted} style={styles.hint}>
          并入后会推送到当前账号，原游客副本保留在本机。
        </AppText>

        <Pressable
          style={styles.primary}
          onPress={onMerge}
          accessibilityRole="button"
          accessibilityLabel="并入当前账号"
        >
          <AppText size={15} weight="700" color={colors.cream}>并入当前账号</AppText>
        </Pressable>

        <Pressable
          style={styles.secondary}
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel="先不并"
        >
          <AppText size={15} weight="600" color={colors.green}>先不并</AppText>
        </Pressable>

        <Pressable
          style={styles.textRow}
          onPress={doExport}
          disabled={Boolean(backedUp)}
          accessibilityRole="button"
          accessibilityLabel={backedUp ? "已备份到本机" : "先导出备份"}
        >
          <AppText size={13} weight="600" color={backedUp ? colors.green : colors.orangeText}>
            {backedUp ? "已备份到本机" : "先导出备份"}
          </AppText>
        </Pressable>

        {backedUp ? (
          <>
            <AppText size={11} color={colors.muted} style={styles.note}>{backedUp}</AppText>
            <AppText size={11} color={colors.muted} style={styles.note}>
              文件在系统下载 / 文件 App 里，也可以稍后再并入。
            </AppText>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(28,34,24,0.36)",
    justifyContent: "flex-end",
    zIndex: 60,
  },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#E0E2D5", alignSelf: "center", marginBottom: spacing.lg,
  },
  counts: { marginTop: spacing.sm },
  hint: { marginTop: spacing.xs, lineHeight: 16 },
  primary: {
    marginTop: spacing.lg,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: {
    marginTop: spacing.sm,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  textRow: { marginTop: spacing.sm, paddingVertical: spacing.md, alignItems: "center" },
  error: { marginBottom: spacing.sm },
  note: { textAlign: "center", lineHeight: 16 },
});
