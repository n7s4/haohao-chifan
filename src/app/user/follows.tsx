import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, usePressScale } from "../../components/Common";
import { Avatar } from "../../components/community/Avatar";
import { FollowButton } from "../../components/community/FollowButton";
import { BackIcon } from "../../components/Icons";
import { Toast, useToast } from "../../components/Toast";
import { getProfiles, type PublicProfile } from "../../lib/community/api";
import { type FollowEntry, FOLLOWS_PAGE, listFollows, relationsTo } from "../../lib/community/social";
import { FALLBACK_NICKNAME, type FollowState, hideBlocked } from "../../lib/community/socialLogic";
import { useBlocks } from "../../lib/community/useBlocks";
import { getSupabase } from "../../lib/supabase";
import { useAuth } from "../../lib/useAuth";
import { colors, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;
type Tab = "following" | "followers";
const TABS: [Tab, string][] = [
  ["following", "关注"],
  ["followers", "粉丝"],
];

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)/profile");
};

/** 关注 / 粉丝列表：按时间倒序分页，每行可直接关注 / 回关。 */
export default function FollowsScreen() {
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const id = params.id;
  const insets = useSafeAreaInsets();
  const { ready: authReady, userId } = useAuth();
  const { blocked } = useBlocks();
  const { toast, showText, undo } = useToast();
  const [tab, setTab] = useState<Tab>(params.tab === "followers" ? "followers" : "following");
  const [rows, setRows] = useState<FollowEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [hasMore, setHasMore] = useState(true);
  const [profiles, setProfiles] = useState<Map<string, PublicProfile>>(new Map());
  const [relations, setRelations] = useState<Map<string, FollowState>>(new Map());
  /** 关系没读出来的人：不显示关注按钮（避免一直转圈），点进主页可以重试。 */
  const [relationFailed, setRelationFailed] = useState<ReadonlySet<string>>(new Set());
  const generation = useRef(0);
  const busy = useRef(false);

  /** 补齐一页用户的昵称头像和我与他们的关系；失败只影响显示（兜底昵称 / 按钮禁用）。 */
  const enrich = useCallback(
    async (page: FollowEntry[], gen: number) => {
      const ids = page.map((r) => r.userId);
      if (!ids.length) return;
      const client = getSupabase();
      const [p, rel] = await Promise.all([
        getProfiles(client, ids).catch(() => null),
        userId ? relationsTo(client, userId, ids).catch(() => null) : Promise.resolve(null),
      ]);
      if (gen !== generation.current) return;
      if (p?.ok) setProfiles((prev) => new Map([...prev, ...p.value]));
      if (rel?.ok) setRelations((prev) => new Map([...prev, ...rel.value]));
      else if (userId) setRelationFailed((prev) => new Set([...prev, ...ids]));
    },
    [userId]
  );

  const load = useCallback(
    async (which: Tab, before: string | undefined, gen: number) => {
      const r = await listFollows(getSupabase(), id, which, before).catch(() => ({ ok: false as const, reason: "network" as const }));
      if (gen !== generation.current) return;
      busy.current = false;
      if (!r.ok) {
        if (!before) setStatus("error");
        return;
      }
      setRows((prev) => (before ? [...prev, ...r.value] : r.value));
      setHasMore(r.value.length >= FOLLOWS_PAGE);
      setStatus("ready");
      enrich(r.value, gen);
    },
    [id, enrich]
  );

  useEffect(() => {
    if (!authReady || !id) return;
    const gen = ++generation.current;
    busy.current = true;
    load(tab, undefined, gen);
  }, [authReady, id, tab, load]);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setRows([]);
    setHasMore(true);
    setStatus("loading");
    setTab(next);
  };

  const retry = () => {
    setStatus("loading");
    const gen = ++generation.current;
    busy.current = true;
    load(tab, undefined, gen);
  };

  const loadMore = () => {
    if (busy.current || !hasMore || status !== "ready" || rows.length === 0) return;
    busy.current = true;
    load(tab, rows[rows.length - 1].createdAt, generation.current);
  };

  const visible = useMemo(() => hideBlocked(rows, blocked, (r) => r.userId), [rows, blocked]);

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <IconButton label="返回" onPress={goBack}>
          <BackIcon size={22} color={colors.ink} />
        </IconButton>
        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map(([key, label]) => {
            const on = key === tab;
            return (
              <Pressable key={key} onPress={() => switchTab(key)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <AppText size={14} weight="700" color={on ? colors.white : colors.muted}>{label}</AppText>
              </Pressable>
            );
          })}
        </View>
        <View style={{ width: ICON_BTN }} />
      </View>

      {!userId && authReady ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted}>登录后可以查看关注和粉丝</AppText>
          <Pressable onPress={() => router.push("/sign-in")} style={styles.retry} accessibilityRole="button">
            <AppText size={14} weight="700" color={colors.white}>去登录</AppText>
          </Pressable>
        </View>
      ) : status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : status === "error" ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted}>网络不太好，没加载出来</AppText>
          <Pressable onPress={retry} style={styles.retry} accessibilityRole="button">
            <AppText size={14} weight="700" color={colors.white}>重试</AppText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r.userId}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.center}>
              <AppText size={14} color={colors.muted}>{tab === "following" ? "还没有关注任何人" : "还没有粉丝"}</AppText>
            </View>
          }
          renderItem={({ item }) => {
            const p = profiles.get(item.userId);
            const name = p?.nickname ?? FALLBACK_NICKNAME;
            return (
              <Pressable onPress={() => router.push(`/user/${item.userId}`)} style={styles.row} accessibilityRole="button" accessibilityLabel={`查看 ${name} 的主页`}>
                <Avatar uri={p?.avatarUrl ?? null} name={name} size={44} />
                <AppText size={15} weight="700" numberOfLines={1} style={styles.rowName}>{name}</AppText>
                {item.userId === userId || (relationFailed.has(item.userId) && !relations.has(item.userId)) ? null : (
                  <FollowButton
                    size="sm"
                    targetId={item.userId}
                    state={relations.get(item.userId)}
                    onChange={(next) => setRelations((prev) => new Map(prev).set(item.userId, next))}
                    toast={showText}
                  />
                )}
              </Pressable>
            );
          }}
        />
      )}
      <Toast toast={toast} bottom={insets.bottom + 24} onUndo={undo} />
    </View>
  );
}

function IconButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const press = usePressScale(0.94);
  return (
    <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      <Animated.View style={[styles.iconBtn, press.style]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 10, minHeight: 52 },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: ICON_BTN / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  tabs: { flex: 1, flexDirection: "row", justifyContent: "center", gap: 8 },
  tab: { height: 32, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  tabOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  rowName: { flex: 1 },
  center: { paddingVertical: spacing.xxl, paddingHorizontal: 20, alignItems: "center" },
  retry: { marginTop: spacing.lg, height: 40, paddingHorizontal: 24, borderRadius: radius.pill, backgroundColor: colors.ink, justifyContent: "center" },
});
