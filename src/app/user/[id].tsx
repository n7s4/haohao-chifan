import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { AppText, usePressScale } from "../../components/Common";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Avatar } from "../../components/community/Avatar";
import { FollowButton } from "../../components/community/FollowButton";
import { NicknameSheet } from "../../components/community/NicknameSheet";
import { ActionSheet, ReportSheet } from "../../components/community/ReportSheet";
import { BackIcon } from "../../components/Icons";
import { coverHeightFor, RecipeTile, splitColumns } from "../../components/RecipeTile";
import { Toast, useToast } from "../../components/Toast";
import { getProfiles, type PublicProfile, report, type ReportReason } from "../../lib/community/api";
import type { CommunityRecipe } from "../../lib/community/logic";
import { getSocialStats, listUserRecipes } from "../../lib/community/social";
import { FALLBACK_NICKNAME, type FollowState, followState } from "../../lib/community/socialLogic";
import { useBlocks } from "../../lib/community/useBlocks";
import { failMessage, useCommunityProfile } from "../../lib/community/useCommunityProfile";
import { getSupabase } from "../../lib/supabase";
import { useAuth } from "../../lib/useAuth";
import { colors, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;
const PAD = 20;
const GAP = 12;

/** 服务端读到的计数和当时的关系；显示的计数按当前关系相对它推算，乐观更新 / 回滚都不用改计数。 */
type Stats = { following: number; followers: number; at: FollowState };

const iFollow = (s: FollowState) => s === "following" || s === "mutual";
const followsMe = (s: FollowState) => s === "followed_by" || s === "mutual";

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)/profile");
};

/** 用户主页：头像、昵称、关注 / 粉丝数、关注按钮、Ta 发布的菜。 */
export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columnWidth = Math.floor((width - PAD * 2 - GAP) / 2);
  const { ready: authReady, userId } = useAuth();
  const community = useCommunityProfile();
  const { blocked, block, unblock } = useBlocks();
  const { toast, showText, undo } = useToast();
  const isMe = Boolean(userId) && userId === id;
  const isBlocked = blocked.has(id);

  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [stats, setStats] = useState<Stats | null>(null);
  const [relation, setRelation] = useState<FollowState | undefined>(undefined);
  const [statsFailed, setStatsFailed] = useState(false);
  const [statsTry, setStatsTry] = useState(0);
  const [recipes, setRecipes] = useState<CommunityRecipe[] | "error" | undefined>(undefined);
  const [coverFailed, setCoverFailed] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [nicknameOpen, setNicknameOpen] = useState(false);

  useEffect(() => {
    if (!authReady || !id) return;
    let alive = true;
    const client = getSupabase();
    getProfiles(client, [id])
      .then((r) => {
        if (alive) setProfile(r.ok ? (r.value.get(id) ?? null) : null);
      })
      .catch(() => alive && setProfile(null));
    listUserRecipes(client, id)
      .then((r) => {
        if (alive) setRecipes(r.ok ? r.value : "error");
      })
      .catch(() => alive && setRecipes("error"));
    return () => {
      alive = false;
    };
  }, [authReady, id]);

  // 关注数 / 关系只对登录用户开放；失败时给重试入口（statsTry 变化即重新拉取）。
  useEffect(() => {
    if (!authReady || !id || !userId) return;
    let alive = true;
    getSocialStats(getSupabase(), id)
      .then((r) => {
        if (!alive) return;
        if (!r.ok) {
          setStatsFailed(true);
          return;
        }
        const at = followState(r.value.iFollow, r.value.followsMe);
        setStatsFailed(false);
        setStats({ following: r.value.following, followers: r.value.followers, at });
        setRelation(at);
      })
      .catch(() => alive && setStatsFailed(true));
    return () => {
      alive = false;
    };
  }, [authReady, id, userId, statsTry]);

  const nickname = isMe
    ? (community.profile?.nickname ?? profile?.nickname ?? FALLBACK_NICKNAME)
    : profile === undefined
      ? ""
      : (profile?.nickname ?? FALLBACK_NICKNAME);

  const shown =
    stats && relation
      ? {
          following: Math.max(0, stats.following + Number(followsMe(relation)) - Number(followsMe(stats.at))),
          followers: Math.max(0, stats.followers + Number(iFollow(relation)) - Number(iFollow(stats.at))),
        }
      : null;

  const doBlock = async () => {
    setConfirmBlock(false);
    const r = await block(id);
    if (!r.ok) {
      showText(failMessage(r.reason));
      return;
    }
    // 数据库已删掉双方的关注。
    setRelation("none");
    showText("已拉黑");
  };

  const doUnblock = async () => {
    const r = await unblock(id);
    showText(r.ok ? "已解除拉黑" : failMessage(r.reason));
  };

  const onReport = async (reason: ReportReason) => {
    setReportOpen(false);
    if (!userId) return;
    const r = await report(getSupabase(), userId, { userId: id }, reason).catch(() => ({ ok: false as const, reason: "network" as const }));
    showText(r.ok ? "收到，我们会尽快处理" : failMessage(r.reason));
  };

  const openMenu = () => {
    if (!userId) {
      router.push("/sign-in");
      return;
    }
    setMenuOpen(true);
  };

  const coverUri = useCallback((cr: CommunityRecipe) => {
    const path = cr.recipe.cover?.path;
    if (!path) return undefined;
    return getSupabase().storage.from("community-media").getPublicUrl(path).data.publicUrl;
  }, []);

  const columns = useMemo(() => {
    if (!Array.isArray(recipes)) return [];
    const measured = recipes.map((cr, index) => ({ cr, height: coverHeightFor(cr.recipe.cover, index, columnWidth, 130, 220) }));
    return splitColumns(measured, (item) => item.height + 22 + 38 + 30 + GAP, GAP);
  }, [recipes, columnWidth]);

  const openFollows = (tab: "following" | "followers") =>
    router.push({ pathname: "/user/follows", params: { id, tab } });

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl }} showsVerticalScrollIndicator={false}>
        <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
          <IconButton label="返回" onPress={goBack}>
            <BackIcon size={22} color={colors.ink} />
          </IconButton>
          <View style={{ flex: 1 }} />
          {isMe ? null : (
            <IconButton label="更多" onPress={openMenu}>
              <MoreIcon />
            </IconButton>
          )}
        </View>

        <View style={styles.head}>
          <Avatar uri={profile?.avatarUrl ?? null} name={nickname || FALLBACK_NICKNAME} size={84} />
          <AppText size={22} weight="800" style={styles.name} numberOfLines={1}>
            {nickname || " "}
          </AppText>
          {shown ? (
            <View style={styles.statsRow}>
              <Pressable onPress={() => openFollows("following")} accessibilityRole="button" hitSlop={8}>
                <AppText size={14} color={colors.muted}>
                  关注 <AppText size={14} weight="800">{shown.following}</AppText>
                </AppText>
              </Pressable>
              <AppText size={14} color={colors.placeholder}>·</AppText>
              <Pressable onPress={() => openFollows("followers")} accessibilityRole="button" hitSlop={8}>
                <AppText size={14} color={colors.muted}>
                  粉丝 <AppText size={14} weight="800">{shown.followers}</AppText>
                </AppText>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.actions}>
            {isMe ? (
              <Pressable onPress={() => setNicknameOpen(true)} style={styles.ghostBtn} accessibilityRole="button">
                <AppText size={14} weight="700">编辑昵称</AppText>
              </Pressable>
            ) : isBlocked ? (
              <Pressable onPress={doUnblock} style={styles.ghostBtn} accessibilityRole="button">
                <AppText size={14} weight="700">解除拉黑</AppText>
              </Pressable>
            ) : userId && statsFailed && relation === undefined ? (
              <Pressable
                onPress={() => {
                  setStatsFailed(false);
                  setStatsTry((n) => n + 1);
                }}
                style={styles.ghostBtn}
                accessibilityRole="button"
              >
                <AppText size={14} weight="700">没加载出来，点此重试</AppText>
              </Pressable>
            ) : (
              <FollowButton targetId={id} state={userId ? relation : "none"} onChange={setRelation} toast={showText} />
            )}
          </View>
        </View>

        <AppText size={16} weight="800" style={styles.section}>
          {isMe ? "我发布的菜" : "Ta 发布的菜"}
        </AppText>
        {isBlocked ? (
          <View style={styles.center}>
            <AppText size={14} color={colors.muted}>你已拉黑 Ta，看不到 Ta 的内容</AppText>
          </View>
        ) : recipes === undefined ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : recipes === "error" ? (
          <View style={styles.center}>
            <AppText size={14} color={colors.muted}>网络不太好，菜没加载出来</AppText>
          </View>
        ) : recipes.length === 0 ? (
          <View style={styles.center}>
            <AppText size={14} color={colors.muted}>还没有发布菜谱</AppText>
          </View>
        ) : (
          <View style={styles.feed}>
            {columns.map((bucket, col) => (
              <View key={col} style={{ width: columnWidth, gap: GAP }}>
                {bucket.map(({ cr, height }) => (
                  <RecipeTile
                    key={cr.id}
                    recipe={{ ...cr.recipe, id: cr.id, custom: false }}
                    artHeight={height}
                    columnWidth={columnWidth}
                    coverUri={coverUri(cr)}
                    coverFailed={coverFailed[cr.id]}
                    onCoverError={() => setCoverFailed((prev) => ({ ...prev, [cr.id]: true }))}
                    stats={{ likes: cr.likeCount, comments: cr.commentCount }}
                    onPress={() => router.push(`/community/${cr.id}`)}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {menuOpen ? (
        <ActionSheet
          actions={[
            isBlocked
              ? { label: "解除拉黑", onPress: () => { setMenuOpen(false); doUnblock(); } }
              : { label: "拉黑", danger: true, onPress: () => { setMenuOpen(false); setConfirmBlock(true); } },
            { label: "举报用户", onPress: () => { setMenuOpen(false); setReportOpen(true); } },
          ]}
          onCancel={() => setMenuOpen(false)}
        />
      ) : null}
      {reportOpen ? <ReportSheet title="举报用户" onSelect={onReport} onCancel={() => setReportOpen(false)} /> : null}
      {confirmBlock ? (
        <ConfirmDialog
          title={`拉黑 ${nickname || FALLBACK_NICKNAME}？`}
          message="拉黑后，你们将无法互相关注和私信，你也不会再看到 Ta 的内容"
          confirmLabel="拉黑"
          destructive
          onCancel={() => setConfirmBlock(false)}
          onConfirm={doBlock}
        />
      ) : null}
      {nicknameOpen ? (
        <NicknameSheet
          title="修改昵称"
          initial={community.profile?.nickname}
          onConfirm={async (next) => {
            const r = await community.rename(next);
            if (!r.ok) return failMessage(r.reason);
            setNicknameOpen(false);
            showText("昵称已更新");
            return null;
          }}
          onCancel={() => setNicknameOpen(false)}
        />
      ) : null}
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

function MoreIcon({ color = colors.ink, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={5.5} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={18.5} cy={12} r={1.8} fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 6, minHeight: 52 },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: ICON_BTN / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  head: { alignItems: "center", paddingHorizontal: PAD, marginTop: spacing.md },
  name: { marginTop: spacing.md, letterSpacing: -0.4, maxWidth: "90%" },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  actions: { marginTop: spacing.lg },
  ghostBtn: {
    height: 38,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { paddingHorizontal: PAD, marginTop: spacing.xl, marginBottom: spacing.md },
  feed: { flexDirection: "row", gap: GAP, paddingHorizontal: PAD },
  center: { paddingVertical: spacing.xxl, paddingHorizontal: PAD, alignItems: "center" },
});
