import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, usePressScale } from "../components/Common";
import { Avatar } from "../components/community/Avatar";
import { BackIcon } from "../components/Icons";
import { Toast, useToast } from "../components/Toast";
import { getProfiles, type PublicProfile } from "../lib/community/api";
import { FALLBACK_NICKNAME } from "../lib/community/socialLogic";
import { useBlocks } from "../lib/community/useBlocks";
import { failMessage } from "../lib/community/useCommunityProfile";
import { getSupabase } from "../lib/supabase";
import { colors, radius, shadow, spacing } from "../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/account");
};

/** 黑名单：列出我拉黑的人，可逐个解除。解除后的人留在列表里（显示「拉黑」可撤回误点），离开页面后消失。 */
export default function BlockedScreen() {
  const insets = useSafeAreaInsets();
  const { blocked, block, unblock, refresh } = useBlocks();
  const { toast, showText, undo } = useToast();
  // 进页面时的名单快照；解除后不立刻移除，方便误点后再拉黑回去。
  const [ids, setIds] = useState<string[] | null>(null);
  const [profiles, setProfiles] = useState<Map<string, PublicProfile>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    refresh().then(() => {
      if (alive) setIds(null);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  const list = ids ?? [...blocked];

  useEffect(() => {
    if (!list.length) return;
    let alive = true;
    getProfiles(getSupabase(), list)
      .then((r) => {
        if (alive && r.ok) setProfiles(r.value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // list 每次渲染都是新数组，用拼接后的字符串做依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.join(",")]);

  const toggle = async (id: string) => {
    if (busy) return;
    if (!ids) setIds([...blocked]);
    setBusy(id);
    const r = blocked.has(id) ? await unblock(id) : await block(id);
    setBusy(null);
    if (!r.ok) showText(failMessage(r.reason));
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <IconButton label="返回" onPress={goBack}>
          <BackIcon size={22} color={colors.ink} />
        </IconButton>
        <AppText size={IS_ANDROID ? 20 : 17} weight="700" style={IS_ANDROID ? styles.titleAndroid : styles.titleIos}>
          黑名单
        </AppText>
        {IS_ANDROID ? null : <View style={{ width: ICON_BTN }} />}
      </View>
      <FlatList
        data={list}
        keyExtractor={(id) => id}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        ListEmptyComponent={
          <View style={styles.center}>
            <AppText size={14} color={colors.muted}>没有拉黑任何人</AppText>
          </View>
        }
        renderItem={({ item }) => {
          const p = profiles.get(item);
          const name = p?.nickname ?? FALLBACK_NICKNAME;
          const isBlocked = blocked.has(item);
          return (
            <View style={styles.row}>
              <Avatar uri={p?.avatarUrl ?? null} name={name} size={44} />
              <AppText size={15} weight="700" numberOfLines={1} style={{ flex: 1 }}>{name}</AppText>
              <Pressable
                onPress={() => toggle(item)}
                disabled={busy !== null}
                style={[styles.btn, isBlocked ? styles.btnGhost : styles.btnDanger]}
                accessibilityRole="button"
              >
                {busy === item ? (
                  <ActivityIndicator size="small" color={colors.muted} />
                ) : (
                  <AppText size={12} weight="700" color={isBlocked ? colors.ink : colors.white}>
                    {isBlocked ? "解除" : "拉黑"}
                  </AppText>
                )}
              </Pressable>
            </View>
          );
        }}
      />
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
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  btn: { height: 30, minWidth: 64, paddingHorizontal: 12, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnDanger: { backgroundColor: colors.danger },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
});
