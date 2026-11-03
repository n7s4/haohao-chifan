import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AddToPlanSheet } from "../../components/AddToPlanSheet";
import { BackupSheet } from "../../components/BackupSheet";
import { AppText, Card } from "../../components/Common";
import { Toast, useToast } from "../../components/Toast";
import { useAuth } from "../../lib/useAuth";
import { addDays, parseKey, startOfWeek, toKey, useStore } from "../../state/store";
import { colors, radius, spacing } from "../../theme";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const dayLabel = (key: string) => {
  const date = parseKey(key);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = date.getTime() === today.getTime();
  const md = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return `${isToday ? "今天" : `周${WEEKDAYS[date.getDay()]}`} · ${md}`;
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const {
    favorites,
    plan,
    weekDays,
    cookedLog,
    shoppingItems,
    lastExportAt,
    guestLocalOnly,
    syncPaused,
    lastSyncedAt,
    pendingCount,
    syncNow,
    syncing,
    findRecipe,
  } = useStore();
  const [addingRecipe, setAddingRecipe] = useState<string | null>(null);
  const { toast, show, undo } = useToast();
  const [backupOpen, setBackupOpen] = useState(false);
  const auth = useAuth();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const lastExportLabel = lastExportAt
    ? `上次 ${Number(lastExportAt.slice(5, 7))} 月 ${Number(lastExportAt.slice(8, 10))} 日`
    : "还没备份过";
  const planned = weekDays.reduce((total, key) => total + Object.keys(plan[key] ?? {}).length, 0);
  // 这行写的是「本周」，不能跟着计划页的 weekAnchor 走，否则翻到下周就成了假的「本周」。
  const thisWeekStart = startOfWeek(new Date());
  const thisWeekDays = Array.from({ length: 7 }, (_, index) => toKey(addDays(thisWeekStart, index)));
  const plannedThisWeek = thisWeekDays.reduce(
    (total, key) => total + Object.keys(plan[key] ?? {}).length,
    0
  );
  // 同理，「本周做了」不能跟着 weekAnchor：翻到下周时它会把这个数字算成 0。
  const cookedThisWeekReal = cookedLog.filter((entry) => thisWeekDays.includes(entry.date)).length;

  /** 相对时间要在渲染之外取，用一分钟一跳的 tick 驱动，避免 render 里读时钟。 */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    // 后台时 setInterval 会被系统挂起，锁屏两小时回来第一眼会是旧文案，
    // 所以回到前台立刻对一次表。
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  /**
   * 同步状态：分钟级只爬到 59 分，再往上换成具体时刻，避免出现「1440 分钟前」。
   * 暂停时整行让位给下面的橙卡，否则「N 项待推送」和「已暂停」自相矛盾。
   */
  const syncLabel = (() => {
    if (!auth.userId || syncPaused) return null;
    // 有积压时这行让位给下面的可点版本，不再重复显示时间。
    if (pendingCount > 0 || syncing) return null;
    if (!lastSyncedAt) return null;
    const minutes = Math.max(0, Math.floor((now - lastSyncedAt) / 60000));
    if (minutes < 1) return "已同步 · 刚刚";
    if (minutes < 60) return `已同步 · ${minutes} 分钟前`;
    const synced = new Date(lastSyncedAt);
    const pad = (value: number) => `${value}`.padStart(2, "0");
    const clock = `${pad(synced.getHours())}:${pad(synced.getMinutes())}`;
    if (toKey(synced) === toKey(new Date(now))) return `已同步 · 今天 ${clock}`;
    const yearPrefix = synced.getFullYear() === new Date(now).getFullYear() ? "" : `${synced.getFullYear()}年`;
    return `已同步 · ${yearPrefix}${synced.getMonth() + 1}月${synced.getDate()}日 ${clock}`;
  })();

  const cookedGroups = (() => {
    const thisStart = startOfWeek(new Date()).getTime();
    const buckets: { key: string; label: string; start: number; entries: typeof cookedLog }[] = [
      { key: "this", label: "本周", start: thisStart, entries: [] },
      { key: "last", label: "上周", start: thisStart - 7 * 86400000, entries: [] },
      { key: "older", label: "更早", start: -Infinity, entries: [] },
    ];
    cookedLog.forEach((entry) => {
      const start = startOfWeek(parseKey(entry.date)).getTime();
      const bucket = buckets.find((item) => start >= item.start) ?? buckets[2];
      bucket.entries.push(entry);
    });
    return buckets.filter((bucket) => bucket.entries.length > 0);
  })();

  const stats = [
    { key: "favorites", label: "已收藏", value: favorites.length, onPress: () => router.push("/(tabs)/favorites") },
    { key: "cooked", label: "本周做了", value: cookedThisWeekReal },
    { key: "planned", label: "计划中", value: planned, onPress: () => router.push("/(tabs)/plan") },
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.avatar}>
          <AppText size={26}>🍳</AppText>
        </View>
        <View style={{ marginLeft: spacing.md }}>
          <AppText size={20} weight="800">文鑫</AppText>
          <AppText size={12} color={colors.muted} style={{ marginTop: 2 }}>
            每一餐，都值得认真对待
          </AppText>
        </View>
      </View>

      <View style={styles.statsRow}>
        {stats.map((item) => (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            disabled={!item.onPress}
            style={styles.statPress}
            accessibilityRole={item.onPress ? "button" : undefined}
            accessibilityLabel={item.onPress ? `查看${item.label}` : undefined}
          >
            <Card style={styles.statCard}>
              <AppText size={22} weight="800" color={colors.green}>
                {item.value}
              </AppText>
              <AppText size={11} color={colors.muted} style={{ marginTop: 2 }}>
                {item.label}
              </AppText>
            </Card>
          </Pressable>
        ))}
      </View>

      <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.xxl }}>
        <AppText size={13} weight="700" style={{ marginBottom: spacing.sm }}>
          最近下厨
        </AppText>
        {cookedLog.length === 0 ? (
          <Card style={styles.emptyCard}>
            <AppText size={12} color={colors.muted} style={{ lineHeight: 19 }}>
              还没有记录。在烹饪页走完最后一步，这里就会留下今天的成果。
            </AppText>
          </Card>
        ) : (
          cookedGroups.map((group) => {
            const opened = group.key === "this" || expanded[group.key];
            const rows = opened ? group.entries : group.entries.slice(0, 2);
            return (
              <View key={group.key} style={{ marginBottom: spacing.sm }}>
                <View style={styles.groupHeader}>
                  <AppText size={11} weight="600" color={colors.muted}>
                    {group.label} · {group.entries.length} 次
                  </AppText>
                  {group.key !== "this" && group.entries.length > 2 ? (
                    <Pressable
                      onPress={() => setExpanded((current) => ({ ...current, [group.key]: !current[group.key] }))}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={opened ? `收起${group.label}记录` : `展开${group.label}记录`}
                    >
                      <AppText size={11} weight="600" color={colors.orangeText}>{opened ? "收起" : "展开"}</AppText>
                    </Pressable>
                  ) : null}
                </View>
                {rows.map((entry, index) => {
                  const name = findRecipe(entry.recipeId)?.name ?? entry.recipeId;
                  return (
                    <Card key={`${entry.date}-${name}-${index}`} style={[styles.row, styles.cookedRow]}>
                      <View style={{ flex: 1 }}>
                        <AppText size={13} weight="600" numberOfLines={1}>{name}</AppText>
                        <AppText size={11} color={colors.muted} style={{ marginTop: 3 }}>
                          {dayLabel(entry.date)}
                        </AppText>
                      </View>
                      <Pressable
                        onPress={() => setAddingRecipe(entry.recipeId)}
                        hitSlop={{ top: 9, bottom: 9 }}
                        style={styles.againButton}
                        accessibilityRole="button"
                        accessibilityLabel={`再做一次${name}`}
                      >
                        <AppText size={10} weight="600" color={colors.orangeText}>再做一次</AppText>
                      </Pressable>
                    </Card>
                  );
                })}
              </View>
            );
          })
        )}

        {guestLocalOnly && auth.userId ? (
          <AppText size={11} color={colors.muted} style={styles.guestNote}>
            这份游客数据只保留在本机。
          </AppText>
        ) : null}

        {syncPaused ? (
          <Card style={[styles.pauseCard]}>
            <View style={{ flex: 1 }}>
              <AppText size={12} weight="600" color={colors.orangeText}>
                同步已暂停
              </AppText>
              <AppText size={11} color={colors.muted} style={{ marginTop: 3, lineHeight: 17 }}>
                {syncPaused} 本机改动都还在，重新登录后会自动继续。
              </AppText>
            </View>
          </Card>
        ) : null}

        {/* 卡片本身不可点：里面既要点进登录页、又要能单独点「立即同步」，
            两个 Pressable 必须是兄弟节点，否则 web 上内层点击会冒泡到外层被带走。 */}
        <Card style={[styles.accountCard, { marginTop: spacing.lg }]}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable
              style={{ flex: 1 }}
              onPress={() => router.push("/sign-in")}
              accessibilityRole="button"
              accessibilityLabel={auth.userId ? "账号与同步" : "登录以同步数据"}
            >
              <AppText size={13} weight="600">{auth.userId ? "账号与同步" : "开启云备份"}</AppText>
              <AppText size={11} color={colors.muted} style={{ marginTop: 3 }} numberOfLines={1}>
                {auth.userId ? auth.email ?? "已登录" : "仅保存在本机 · 未开启云备份"}
              </AppText>
              {auth.userId ? (
                <AppText size={11} color={colors.muted} style={{ marginTop: 2 }} numberOfLines={1}>
                  本周 {plannedThisWeek} 顿 · {favorites.length} 收藏 · {shoppingItems.length} 条清单
                </AppText>
              ) : null}
            </Pressable>
            <AppText size={14} color={colors.muted}>›</AppText>
          </View>
          {auth.userId && (pendingCount > 0 || syncing) ? (
            <Pressable
              onPress={syncNow}
              disabled={syncing}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={syncing ? "正在同步" : `立即同步 ${pendingCount} 项改动`}
            >
              <AppText
                size={11}
                color={syncing ? colors.muted : colors.orangeText}
                style={{ marginTop: 6 }}
                numberOfLines={1}
              >
                {syncing ? "正在同步…" : `${pendingCount} 项待推送 · 点此同步`}
              </AppText>
            </Pressable>
          ) : syncLabel ? (
            <AppText size={11} color={colors.muted} style={{ marginTop: 6 }} numberOfLines={1}>
              {syncLabel}
            </AppText>
          ) : null}
        </Card>

        <Card
          style={[styles.row, { marginTop: spacing.md }]}
          onPress={() => setBackupOpen(true)}
          accessibilityLabel="导出与导入备份"
        >
          <View style={{ flex: 1 }}>
            <AppText size={13} weight="600">导出 / 导入备份</AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 3 }}>
              换机前把菜单、收藏和清单存成一个文件
            </AppText>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <AppText size={10} color={colors.muted}>{lastExportLabel}</AppText>
            <AppText size={14} color={colors.muted}>›</AppText>
          </View>
        </Card>

        <Card style={[styles.row, { marginTop: spacing.md }]}>
          <View style={{ flex: 1 }}>
            <AppText size={13} weight="600">关于好好吃饭</AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 3 }}>
              v1.0.0 · 原生版
            </AppText>
          </View>
        </Card>
        <AppText size={10} color={colors.muted} style={styles.note}>
          {auth.userId
            ? "菜单、收藏与采购清单已随账号同步，换手机登录即可恢复。"
            : "菜单、收藏与采购清单保存在这台设备上；卸载或换机前请留意备份。"}
        </AppText>
      </View>

      <Toast toast={toast} bottom={96} onUndo={undo} />

      {addingRecipe ? (
        <AddToPlanSheet
          recipeId={addingRecipe}
          onClose={() => setAddingRecipe(null)}
          onDone={(message, undoCb) => {
            setAddingRecipe(null);
            show(undoCb ? { text: message, undo: undoCb } : { text: message });
          }}
        />
      ) : null}

      {backupOpen ? <BackupSheet onClose={() => setBackupOpen(false)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  accountCard: { padding: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xl },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.beige,
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xxl, paddingHorizontal: spacing.xl },
  statPress: { flex: 1 },
  statCard: { alignItems: "center", paddingVertical: spacing.lg, borderRadius: radius.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  emptyCard: { padding: spacing.lg, borderRadius: radius.lg },
  guestNote: { marginTop: spacing.lg, marginBottom: spacing.xs, marginLeft: spacing.xs },
  pauseCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.orangeSoft,
    marginTop: spacing.md,
  },
  cookedRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  groupHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xs, marginBottom: spacing.xs,
  },
  againButton: {
    width: 76, height: 26, borderRadius: 13, borderWidth: 1.2, borderColor: colors.orangeText,
    alignItems: "center", justifyContent: "center",
  },
  note: { marginTop: spacing.xs, lineHeight: 16 },
});
