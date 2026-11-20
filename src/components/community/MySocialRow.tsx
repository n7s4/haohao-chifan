import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { getSocialStats } from "../../lib/community/social";
import { getSupabase } from "../../lib/supabase";
import { colors, radius, shadow } from "../../theme";
import { AppText } from "../Common";
import { ChevronRightIcon } from "../Icons";

/** 「我的」页头像下面一行：关注 N · 粉丝 N · 我的主页。每次回到这页时刷新计数。 */
export function MySocialRow({ userId }: { userId: string }) {
  const [counts, setCounts] = useState<{ userId: string; following: number; followers: number } | null>(null);
  const shown = counts && counts.userId === userId ? counts : null;

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getSocialStats(getSupabase(), userId)
        .then((r) => {
          if (alive && r.ok) setCounts({ userId, following: r.value.following, followers: r.value.followers });
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [userId])
  );

  const openFollows = (tab: "following" | "followers") =>
    router.push({ pathname: "/user/follows", params: { id: userId, tab } });

  return (
    <View style={styles.row}>
      <Pressable onPress={() => openFollows("following")} style={styles.cell} accessibilityRole="button" accessibilityLabel={`关注 ${shown?.following ?? ""}`}>
        <AppText size={17} weight="800">{shown ? shown.following : "–"}</AppText>
        <AppText size={12} color={colors.muted}>关注</AppText>
      </Pressable>
      <Pressable onPress={() => openFollows("followers")} style={styles.cell} accessibilityRole="button" accessibilityLabel={`粉丝 ${shown?.followers ?? ""}`}>
        <AppText size={17} weight="800">{shown ? shown.followers : "–"}</AppText>
        <AppText size={12} color={colors.muted}>粉丝</AppText>
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => router.push(`/user/${userId}`)} style={styles.home} accessibilityRole="button">
        <AppText size={13} weight="700">我的主页</AppText>
        <ChevronRightIcon size={16} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 22, paddingHorizontal: 20, marginTop: 14 },
  cell: { alignItems: "flex-start" },
  home: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 34,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
});
