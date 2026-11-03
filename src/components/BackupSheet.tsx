import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "./Common";
import { ConfirmDialog } from "./ConfirmDialog";
import { backupFileName, readableStamp, saveJsonFile } from "../lib/exportFile";
import { useStore } from "../state/store";
import { colors, radius, spacing } from "../theme";

type Status = { tone: "ok" | "warn"; text: string } | null;

export function BackupSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { exportBackup, importBackup, markExported, plan, favorites } = useStore();
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    raw: string;
    summary: string;
    source: "guest" | "account";
    when: string;
    replaced: { plan: number; favorites: number };
  } | null>(null);

  /** 导入前的本地内容计数：确认框要说清「会丢什么」，才有决策价值。 */
  const currentCounts = () => ({
    plan: Object.values(plan).reduce((sum, day) => sum + Object.keys(day ?? {}).length, 0),
    favorites: favorites.length,
  });

  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const name = backupFileName();
      const result = await saveJsonFile(exportBackup(), name);
      markExported();
      setStatus(
        result.shared
          ? { tone: "ok", text: Platform.OS === "web" ? `已导出 ${name}` : "备份文件已生成，选择「存储到文件」保存" }
          : { tone: "warn", text: `系统分享不可用，文件在 ${result.uri}` }
      );
    } catch (error) {
      setStatus({ tone: "warn", text: `导出失败：${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const readPickedFile = async (): Promise<string | null> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/json", "text/plain", "*/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    if (Platform.OS === "web" && asset.file) return asset.file.text();
    return new File(asset.uri).text();
  };

  const doImport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const raw = await readPickedFile();
      if (raw === null) {
        setBusy(false);
        return;
      }
      let summary = "";
      try {
        const parsed = JSON.parse(raw) as {
          app?: string;
          source?: "guest" | "account";
          exportedAt?: string;
          data?: { plan?: object; favorites?: string[]; manualItems?: unknown[] };
        };
        const days = parsed.data?.plan ? Object.values(parsed.data.plan).filter((day) => Object.keys(day ?? {}).length > 0).length : 0;
        const kind = parsed.source === "guest" ? "游客备份" : "账号备份";
        const when = parsed.exportedAt ? readableStamp(parsed.exportedAt) : "未知";
        summary = `${kind} · 备份时间 ${when} · ${days} 天有安排 · ${parsed.data?.favorites?.length ?? 0} 个收藏`;
        setPendingImport({
          raw,
          summary,
          source: parsed.source === "guest" ? "guest" : "account",
          when,
          replaced: currentCounts(),
        });
      } catch {
        setStatus({ tone: "warn", text: "文件不是有效的 JSON，没有导入" });
        setBusy(false);
        return;
      }
      setBusy(false);
    } catch (error) {
      setStatus({ tone: "warn", text: `读取失败：${(error as Error).message}` });
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!pendingImport || busy) return;
    const raw = pendingImport.raw;
    setPendingImport(null);
    setBusy(true);
    try {
      const result = await importBackup(raw);
      if (!result.ok) {
        setStatus({ tone: "warn", text: `导入失败：${result.error}` });
        return;
      }
      // 两种回执不能共用一句话：后续该做的事不一样（一个等同步，一个等联网）。
      setStatus({
        tone: "ok",
        text: result.degraded ? "已恢复到本机，联网后自动同步" : "已恢复，正在同步到云端",
      });
    } catch (error) {
      setStatus({ tone: "warn", text: `导入失败：${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭备份" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.handle} />
        <AppText size={16} weight="800">导出 / 导入备份</AppText>
        <AppText size={11} color={colors.muted} style={{ marginTop: 4, lineHeight: 17 }}>
          备份是一个 JSON 文件，包含菜单、收藏、评分、份量、做菜记录和采购清单。换机时先导出，在新设备上导入即可。
        </AppText>

        <Pressable
          style={styles.primaryRow}
          onPress={doExport}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="导出备份文件"
        >
          <View style={{ flex: 1 }}>
            <AppText size={14} weight="600" color={colors.cream}>
              {busy ? "处理中…" : "导出备份"}
            </AppText>
            <AppText size={11} color="#DCE4D4" style={{ marginTop: 2 }}>
              生成一个带日期的 JSON 文件
            </AppText>
          </View>
          <AppText size={15} color={colors.cream}>↓</AppText>
        </Pressable>

        <Pressable
          style={styles.secondaryRow}
          onPress={doImport}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="从文件导入"
        >
          <View style={{ flex: 1 }}>
            <AppText size={14} weight="600" color={colors.green}>
              {busy ? "导入中…" : "从文件导入"}
            </AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 2 }}>
              会先展示备份摘要，确认后才覆盖
            </AppText>
          </View>
          <AppText size={15} color={colors.green}>↑</AppText>
        </Pressable>

        {status ? (
          <View style={[styles.status, status.tone === "warn" && styles.statusWarn]}>
            <AppText size={11} color={status.tone === "warn" ? colors.orangeText : colors.green} style={{ lineHeight: 17 }}>
              {status.text}
            </AppText>
          </View>
        ) : null}

        <Pressable onPress={onClose} style={styles.closeRow} accessibilityRole="button" accessibilityLabel="关闭">
          <AppText size={13} color={colors.muted}>关闭</AppText>
        </Pressable>
      </View>
    </View>
    {pendingImport ? (
      <ConfirmDialog
        title={pendingImport.source === "guest" ? "导入这份游客备份？" : "覆盖当前数据？"}
        message={`将用备份替换当前 ${pendingImport.replaced.plan} 个餐位、${pendingImport.replaced.favorites} 个收藏，云端也会一起替换。\n\n${pendingImport.summary}${
          pendingImport.source === "guest"
            ? `\n\n这是未登录时留下的那份（备份时间 ${pendingImport.when}），可能比当前账号的内容旧。`
            : ""
        }`}
        confirmLabel="覆盖导入"
        destructive
        onCancel={() => setPendingImport(null)}
        onConfirm={confirmImport}
      />
    ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(28,34,24,0.32)",
    justifyContent: "flex-end",
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
  primaryRow: {
    marginTop: spacing.lg,
    minHeight: 60,
    borderRadius: radius.md,
    backgroundColor: colors.green,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  secondaryRow: {
    marginTop: spacing.sm,
    minHeight: 60,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.green,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  status: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.greenSoft,
  },
  statusWarn: { backgroundColor: colors.orangeSoft },
  closeRow: { marginTop: spacing.md, paddingVertical: spacing.md, alignItems: "center" },
});
