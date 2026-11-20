import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, usePressScale } from "../../components/Common";
import { Avatar } from "../../components/community/Avatar";
import { BackIcon } from "../../components/Icons";
import { getProfiles, type PublicProfile } from "../../lib/community/api";
import { type ConversationSummary, listConversations, subscribeMessages } from "../../lib/community/messages";
import { badgeText, formatChatTime } from "../../lib/community/messagesLogic";
import { FALLBACK_NICKNAME } from "../../lib/community/socialLogic";
import { useUnread } from "../../lib/community/useUnread";
import { getSupabase } from "../../lib/supabase";
import { useAuth } from "../../lib/useAuth";
import { colors, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)");
};

/** 消息列表：私信 + 群聊，按最后消息时间倒序（服务端已排序）。 */
export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { ready, userId } = useAuth();
  const { refresh: refreshUnread } = useUnread();
  // 带着所属 userId，换账号时自然失效。
  const [loaded, setLoaded] = useState<{ userId: string; list: ConversationSummary[] | "error" } | null>(null);
  const [profiles, setProfiles] = useState<Map<string, PublicProfile>>(new Map());
  const list = loaded && loaded.userId === userId ? loaded.list : undefined;

  const load = useCallback(async () => {
    if (!userId) return;
    const r = await listConversations(getSupabase()).catch(() => null);
    if (!r || !r.ok) {
      setLoaded((prev) => (prev?.userId === userId && Array.isArray(prev.list) ? prev : { userId, list: "error" }));
      return;
    }
    setLoaded({ userId, list: r.value });
    refreshUnread();
  }, [userId, refreshUnread]);

  // 聚焦时刷新列表和红点（从聊天页返回时未读会清零）。
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // 在本页时订阅新消息（RLS 只推我能看的）和被拉进新群；500ms 防抖后重新拉。
  useEffect(() => {
    if (!userId) return;
    const client = getSupabase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 500);
    };
    const unsubMessages = subscribeMessages(client, {}, bump);
    const channel = client.channel(`conversation-members-${userId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${userId}` },
        bump,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      unsubMessages();
      void client.removeChannel(channel);
    };
  }, [userId, load]);

  const peerKey = Array.isArray(list)
    ? list.flatMap((c) => (c.peerId ? [c.peerId] : [])).sort().join(",")
    : "";
  useEffect(() => {
    if (!peerKey) return;
    let alive = true;
    getProfiles(getSupabase(), peerKey.split(","))
      .then((r) => {
        if (alive && r.ok) setProfiles(r.value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [peerKey]);

  const now = new Date();

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <IconButton label="返回" onPress={goBack}>
          <BackIcon size={22} color={colors.ink} />
        </IconButton>
        <AppText size={IS_ANDROID ? 20 : 17} weight="700" style={IS_ANDROID ? styles.titleAndroid : styles.titleIos}>
          消息
        </AppText>
        {userId ? (
          <Pressable
            onPress={() => router.push("/messages/new-group")}
            style={styles.groupBtn}
            accessibilityRole="button"
          >
            <AppText size={13} weight="700">发起群聊</AppText>
          </Pressable>
        ) : IS_ANDROID ? null : (
          <View style={{ width: ICON_BTN }} />
        )}
      </View>
      {!ready ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : !userId ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted}>登录后才能收发消息</AppText>
          <Pressable onPress={() => router.push("/sign-in")} style={styles.loginBtn} accessibilityRole="button">
            <AppText size={14} weight="700" color={colors.white}>去登录</AppText>
          </Pressable>
        </View>
      ) : list === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : list === "error" ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted}>网络不太好，消息没加载出来</AppText>
          <Pressable onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
            <AppText size={14} weight="700">点此重试</AppText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ListEmptyComponent={
            <View style={styles.center}>
              <AppText size={14} color={colors.muted}>还没有消息，去社区认识新朋友吧</AppText>
            </View>
          }
          renderItem={({ item }) => {
            const peer = item.peerId ? profiles.get(item.peerId) : undefined;
            const isGroup = item.kind === "group";
            const title = isGroup ? (item.name ?? "群聊") : (peer?.nickname ?? FALLBACK_NICKNAME);
            return (
              <Pressable
                onPress={() =>
                  isGroup
                    ? router.push({ pathname: "/messages/group/[id]", params: { id: item.id } })
                    : router.push({ pathname: "/messages/[id]", params: { id: item.id } })
                }
                style={styles.row}
                accessibilityRole="button"
              >
                <Avatar uri={isGroup ? null : (peer?.avatarUrl ?? null)} name={title} size={48} />
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <AppText size={15} weight="700" numberOfLines={1} style={{ flex: 1 }}>{title}</AppText>
                    <AppText size={12} color={colors.placeholder}>{formatChatTime(item.lastMessageAt, now)}</AppText>
                  </View>
                  <View style={styles.rowTop}>
                    <AppText size={13} color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>
                      {item.lastBody ?? ""}
                    </AppText>
                    {item.unread > 0 ? (
                      <View style={styles.badge}>
                        <AppText size={11} weight="800" color={colors.white}>{badgeText(item.unread)}</AppText>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
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
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 12, paddingBottom: 6, minHeight: 52 },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: ICON_BTN / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  titleIos: { flex: 1, textAlign: "center" },
  titleAndroid: { flex: 1, paddingLeft: 4 },
  groupBtn: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { paddingVertical: spacing.xxl, paddingHorizontal: 20, alignItems: "center", gap: spacing.md },
  loginBtn: { height: 38, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  retryBtn: {
    height: 38,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
