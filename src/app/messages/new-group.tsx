import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, usePressScale } from "../../components/Common";
import { MutualPicker, useMutuals } from "../../components/community/MutualPicker";
import { BackIcon } from "../../components/Icons";
import { Toast, useToast } from "../../components/Toast";
import { createGroup } from "../../lib/community/messages";
import {
  canCreateGroup,
  defaultGroupName,
  GROUP_MAX_MEMBERS,
  GROUP_NAME_MAX,
  toggleSelected,
  validateGroupName,
} from "../../lib/community/messagesLogic";
import { FALLBACK_NICKNAME } from "../../lib/community/socialLogic";
import { failMessage } from "../../lib/community/useCommunityProfile";
import { getSupabase } from "../../lib/supabase";
import { useAuth } from "../../lib/useAuth";
import { colors, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/messages");
};

/** 发起群聊：从互相关注的人里多选（至少 2 人），群名默认取前 3 个昵称。 */
export default function NewGroupScreen() {
  const insets = useSafeAreaInsets();
  const { ready, userId } = useAuth();
  const { toast, showText, undo } = useToast();
  const { state, reload } = useMutuals(userId);
  const [selected, setSelected] = useState<string[]>([]);
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const press = usePressScale();

  const profiles = state.status === "ready" ? state.profiles : undefined;
  const autoName = useMemo(
    () => defaultGroupName(selected.map((id) => profiles?.get(id)?.nickname ?? FALLBACK_NICKNAME)),
    [selected, profiles],
  );
  // 手动改过群名就不再跟着选择变；清空后恢复默认。
  const name = edited ?? autoName;
  const validName = validateGroupName(name);
  const canSubmit = canCreateGroup(selected.length) && validName !== null && !busy;

  const submit = async () => {
    if (!canSubmit || !validName) return;
    setBusy(true);
    const r = await createGroup(getSupabase(), validName, selected).catch(() => null);
    if (!r) {
      setBusy(false);
      showText(failMessage("network"));
      return;
    }
    if (!r.ok) {
      setBusy(false);
      showText(failMessage(r.reason));
      return;
    }
    router.replace({ pathname: "/messages/[id]", params: { id: r.value } });
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <BackButton />
        <AppText size={IS_ANDROID ? 20 : 17} weight="700" style={IS_ANDROID ? styles.titleAndroid : styles.titleIos}>
          发起群聊
        </AppText>
        <Pressable
          onPress={submit}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="创建"
          accessibilityState={{ disabled: !canSubmit, busy }}
        >
          <Animated.View style={[styles.createBtn, !canSubmit && { opacity: 0.4 }, press.style]}>
            {busy ? <ActivityIndicator color={colors.white} size="small" /> : <AppText size={14} weight="700" color={colors.white}>创建</AppText>}
          </Animated.View>
        </Pressable>
      </View>

      {!userId && ready ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted}>登录后可以发起群聊</AppText>
          <Pressable onPress={() => router.push("/sign-in")} style={styles.pill} accessibilityRole="button">
            <AppText size={14} weight="700" color={colors.white}>去登录</AppText>
          </Pressable>
        </View>
      ) : state.status === "loading" ? (
        <View style={styles.center}><ActivityIndicator color={colors.muted} /></View>
      ) : state.status === "error" ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted}>网络不太好，没加载出来</AppText>
          <Pressable onPress={() => { void reload(); }} style={styles.pill} accessibilityRole="button">
            <AppText size={14} weight="700" color={colors.white}>重试</AppText>
          </Pressable>
        </View>
      ) : state.ids.length === 0 ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted}>还没有互相关注的人，先去社区关注几位吧</AppText>
        </View>
      ) : (
        <MutualPicker
          ids={state.ids}
          profiles={state.profiles}
          selected={selected}
          onToggle={(id) => setSelected((s) => toggleSelected(s, id))}
          maxSelect={GROUP_MAX_MEMBERS - 1}
          bottomPad={insets.bottom + spacing.xxl}
          header={
            <View style={styles.head}>
              <TextInput
                value={name}
                onChangeText={(t) => setEdited(t === "" ? null : t)}
                placeholder="群名"
                placeholderTextColor={colors.placeholder}
                maxLength={GROUP_NAME_MAX}
                autoCorrect={false}
                accessibilityLabel="群名"
                style={styles.input}
              />
              <AppText size={13} color={colors.muted} style={{ marginTop: spacing.sm }}>
                {selected.length < 2 ? `再选 ${2 - selected.length} 位互相关注的人就能创建` : `已选 ${selected.length} 人`}
              </AppText>
            </View>
          }
        />
      )}
      <Toast toast={toast} bottom={insets.bottom + 24} onUndo={undo} />
    </View>
  );
}

function BackButton() {
  const press = usePressScale(0.94);
  return (
    <Pressable onPress={goBack} onPressIn={press.onPressIn} onPressOut={press.onPressOut} accessibilityRole="button" accessibilityLabel="返回" hitSlop={4}>
      <Animated.View style={[styles.iconBtn, press.style]}>
        <BackIcon size={22} color={colors.ink} />
      </Animated.View>
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
  createBtn: { height: 36, minWidth: 64, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  head: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  input: {
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  center: { paddingVertical: spacing.xxl, paddingHorizontal: 20, alignItems: "center", gap: spacing.md },
  pill: { height: 38, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
});
