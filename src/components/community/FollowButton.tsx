import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";

import { follow, unfollow } from "../../lib/community/social";
import { afterToggle, followButtonLabel, type FollowState, isFollowing } from "../../lib/community/socialLogic";
import { getSupabase } from "../../lib/supabase";
import { useAuth } from "../../lib/useAuth";
import { colors, radius } from "../../theme";
import { AppText, usePressScale } from "../Common";

/**
 * 关注按钮：乐观更新，失败回滚并提示。state 由父组件持有（主页的粉丝数要跟着变），
 * state 为 undefined 表示关系还没读出来，按钮先禁用。游客点击去登录。
 */
export function FollowButton({
  targetId,
  state,
  onChange,
  toast,
  size = "md",
}: {
  targetId: string;
  state: FollowState | undefined;
  onChange: (next: FollowState) => void;
  toast: (text: string) => void;
  size?: "sm" | "md";
}) {
  const { ready, userId } = useAuth();
  const press = usePressScale(0.94);
  const busy = useRef(false);
  const on = state !== undefined && isFollowing(state);
  const small = size === "sm";

  const onPress = async () => {
    if (!ready) return;
    if (!userId) {
      router.push("/sign-in");
      return;
    }
    if (busy.current || state === undefined) return;
    busy.current = true;
    const prev = state;
    const next = afterToggle(prev);
    onChange(next);
    Haptics.selectionAsync().catch(() => {});
    const call = isFollowing(next) ? follow : unfollow;
    const r = await call(getSupabase(), userId, targetId).catch(() => ({ ok: false as const, reason: "network" as const }));
    busy.current = false;
    if (!r.ok) {
      onChange(prev);
      toast(isFollowing(next) ? "暂时无法关注" : "网络不太好，稍后再试");
    }
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={state === undefined && Boolean(userId)}
      accessibilityRole="button"
      accessibilityLabel={state ? followButtonLabel(state) : "关注"}
      accessibilityState={{ selected: on }}
      hitSlop={6}
    >
      <Animated.View style={[styles.btn, small && styles.btnSm, on ? styles.btnOn : styles.btnOff, press.style]}>
        {state === undefined && userId ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : (
          <AppText size={small ? 12 : 14} weight="700" color={on ? colors.muted : colors.white}>
            {followButtonLabel(state ?? "none")}
          </AppText>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { height: 38, minWidth: 96, paddingHorizontal: 18, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  btnSm: { height: 30, minWidth: 72, paddingHorizontal: 12 },
  btnOff: { backgroundColor: colors.accent },
  btnOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
