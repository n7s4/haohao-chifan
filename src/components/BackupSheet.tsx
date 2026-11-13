import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { AppText } from "./Common";
import { ConfirmDialog } from "./ConfirmDialog";
import { backupFileName, readableStamp, saveJsonFile } from "../lib/exportFile";
import { useStore } from "../state/store";
import { colors, motion, radius, shadow, spacing } from "../theme";

const IS_ANDROID = Platform.OS === "android";
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

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
    <Animated.View
      entering={FadeIn.duration(motion.duration.base)}
      exiting={FadeOut.duration(motion.duration.fast)}
      style={styles.backdrop}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭备份" />
      <Animated.View
        entering={SlideInDown.duration(motion.duration.slow).easing(EASE_OUT)}
        exiting={SlideOutDown.duration(motion.duration.base)}
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        accessibilityViewIsModal
      >
        <View style={styles.grab} />
        <View style={styles.head}>
          <View style={styles.badge}>
            <BoxIcon size={24} color={colors.ink} />
          </View>
          <AppText size={21} weight="800" style={styles.title}>备份你的菜谱和计划</AppText>
        </View>
        <AppText size={14} color={colors.muted} style={styles.lead}>
          换手机或重装时，用它恢复全部数据。
        </AppText>

        <PressScale
          style={[styles.btn, styles.btnDark, busy && styles.btnBusy]}
          onPress={doExport}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="导出备份文件"
          accessibilityState={{ disabled: busy, busy }}
        >
          {busy ? <ActivityIndicator size="small" color={colors.white} /> : <DownloadIcon size={20} color={colors.white} />}
          <AppText size={16} weight="700" color={colors.white}>{busy ? "处理中…" : "导出备份文件"}</AppText>
        </PressScale>

        <PressScale
          style={[styles.btn, styles.btnSoft, { marginTop: 10 }, busy && styles.btnBusy]}
          onPress={doImport}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="从文件导入"
          accessibilityState={{ disabled: busy, busy }}
        >
          <UploadIcon size={20} color={colors.ink} />
          <AppText size={16} weight="700">{busy ? "导入中…" : "从文件导入"}</AppText>
        </PressScale>

        {status ? (
          <Animated.View
            key={status.text}
            entering={FadeInDown.duration(motion.duration.base).easing(EASE_OUT)}
            style={[styles.status, status.tone === "warn" ? styles.statusWarn : styles.statusOk]}
            accessibilityLiveRegion="polite"
          >
            <View style={[styles.statusDot, { backgroundColor: status.tone === "warn" ? colors.accent : colors.leaf }]}>
              {status.tone === "warn" ? <BangMark /> : <CheckMark />}
            </View>
            <AppText
              size={13}
              weight="600"
              color={status.tone === "warn" ? colors.accentText : colors.leafText}
              style={{ flex: 1, lineHeight: 19 }}
            >
              {status.text}
            </AppText>
          </Animated.View>
        ) : null}

        <Pressable onPress={onClose} style={styles.closeRow} accessibilityRole="button" accessibilityLabel="关闭">
          <AppText size={14} weight="600" color={colors.muted}>关闭</AppText>
        </Pressable>
      </Animated.View>
    </Animated.View>
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

const APressable = Animated.createAnimatedComponent(Pressable);

/** 按下回弹（设计稿 .btn:active scale(.96) + ease-spring）。 */
function PressScale({
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style" | "children"> & { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <APressable
      {...rest}
      onPressIn={(event) => {
        scale.set(withSpring(0.96, motion.spring));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, motion.spring));
        onPressOut?.(event);
      }}
      style={[style, animated]}
    >
      {children}
    </APressable>
  );
}

type IconProps = { size?: number; color?: string };

function BoxIcon({ size = 20, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5zM4 8.5 12 13l8-4.5M12 13v7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function DownloadIcon({ size = 20, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function UploadIcon({ size = 20, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function CheckMark() {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
      <Path d="m5 12.5 4.5 4.5L19 7.5" stroke={colors.white} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function BangMark() {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5v9M12 19v.5" stroke={colors.white} strokeWidth={3.4} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
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
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.skySoft,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-6deg" }],
  },
  title: { flex: 1, letterSpacing: -0.3, lineHeight: 27 },
  lead: { marginTop: spacing.md, marginBottom: 18, lineHeight: 21 },
  btn: {
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: 22,
    borderRadius: IS_ANDROID ? radius.pill : 16,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  btnDark: { backgroundColor: colors.ink },
  btnSoft: { backgroundColor: colors.surfaceAlt },
  btnBusy: { opacity: 0.6 },
  caption: { textAlign: "center", marginTop: 10 },
  status: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  statusOk: { backgroundColor: colors.leafSoft },
  statusWarn: { backgroundColor: colors.accentSoft },
  statusDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -1,
  },
  closeRow: { marginTop: spacing.sm, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
