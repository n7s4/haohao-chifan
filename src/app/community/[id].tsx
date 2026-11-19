import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { AppText, usePressScale } from "../../components/Common";
import { Comments, type CommentsHandle } from "../../components/community/Comments";
import { ActionSheet, ReportSheet } from "../../components/community/ReportSheet";
import { FoodArt } from "../../components/FoodArt";
import { BackIcon, HeartIcon } from "../../components/Icons";
import { ImageViewer, type ViewerImage } from "../../components/ImageViewer";
import { RecipeBody, rise } from "../../components/recipe/RecipeBody";
import { ART_TINTS } from "../../components/RecipeTile";
import { Toast, useToast } from "../../components/Toast";
import { type Recipe, recipeSubtitle } from "../../data/recipes";
import {
  type FailReason,
  getCommunityRecipe,
  getProfiles,
  myLikes,
  type PublicProfile,
  report,
  type ReportReason,
  type Result,
  setLike,
} from "../../lib/community/api";
import {
  applyLikeToggle,
  canSaveToMine,
  type CommunityRecipe,
  favoriteIdFor,
  likeAfterLookup,
  parseCommunityFavoriteId,
} from "../../lib/community/logic";
import { failMessage } from "../../lib/community/useCommunityProfile";
import { useSaveToMine } from "../../lib/community/useSaveToMine";
import type { StepImage } from "../../lib/steps";
import { getSupabase } from "../../lib/supabase";
import { useAuth } from "../../lib/useAuth";
import { useStore } from "../../state/store";
import { colors, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;
const PUBLIC_BUCKET = "community-media";
const BRAND_NAME = "好好吃饭";
/** 作者资料取不到时的兜底昵称（与默认昵称同前缀，不暴露任何账号信息）。 */
const FALLBACK_NICKNAME = "吃饭的人";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_MARK = require("../../../assets/icon.png");

type PageState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "unavailable" }
  | { status: "ready"; cr: CommunityRecipe };

/** 网络异常（fetch 直接抛）也折成 Result，页面只处理一种失败形态。 */
const settle = <T,>(p: Promise<Result<T>>): Promise<Result<T>> =>
  p.catch((): Result<T> => ({ ok: false, reason: "network" }));

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** 社区菜详情：游客可看；点赞 / 收藏 / 存到我的菜谱 / 举报需登录。任一请求说「不可用」就整页变成已下架。 */
export default function CommunityRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const coverHeight = Math.round(Math.min(340, Math.max(260, windowHeight * 0.4)));
  const { ready: authReady, userId } = useAuth();
  const { favorites, toggleFavorite } = useStore();
  const saveToMine = useSaveToMine();
  const { toast, show, showText, undo } = useToast();

  const [page, setPage] = useState<PageState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // undefined = 还在读；null = 读失败或没有公开资料（显示兜底昵称）。
  const [author, setAuthor] = useState<PublicProfile | null | undefined>(undefined);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  // 「我赞没赞」带着所属账号：换账号 / 登出后自然失效，不用在 effect 里同步清。
  const [likedFor, setLikedFor] = useState<{ userId: string; liked: boolean } | null>(null);
  const [liking, setLiking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [servings, setServings] = useState(1);
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const likeBusy = useRef(false);
  const saveBusy = useRef(false);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  /** 评论区：「评论」按钮滚到这里，并打开评论框。 */
  const commentsRef = useRef<React.ComponentRef<typeof View>>(null);
  const commentsHandle = useRef<CommentsHandle>(null);
  const commentsY = useRef(0);

  // 路由没带 id：没有可读的菜，直接显示已下架，不会一直转圈。
  const view: PageState = id ? page : { status: "unavailable" };
  const cr = view.status === "ready" ? view.cr : null;
  const liked = likedFor !== null && likedFor.userId === userId ? likedFor.liked : null;

  const markUnavailable = useCallback(() => setPage({ status: "unavailable" }), []);
  /** 失败统一处理：unavailable → 整页下架；其他 → toast。 */
  const onFail = useCallback(
    (reason: FailReason, message = failMessage(reason)) => {
      if (reason === "unavailable") markUnavailable();
      else showText(message);
    },
    [markUnavailable, showText]
  );

  // 读菜：首屏 status 已是 loading；重试时由 retry() 置 loading，effect 里不同步 setState。
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const client = getSupabase();
    settle(getCommunityRecipe(client, id)).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setPage({ status: r.reason === "unavailable" ? "unavailable" : "error" });
        return;
      }
      setPage({ status: "ready", cr: r.value });
      setLikeCount(r.value.likeCount);
      setCommentCount(r.value.commentCount);
      const authorId = r.value.authorId;
      // 内置菜 / 作者 id 缺失：没有资料可读，直接落到兜底昵称，存菜按钮不会一直禁用。
      if (r.value.builtin || !authorId) {
        setAuthor(null);
        return;
      }
      setAuthor(undefined);
      // 作者资料取不到只影响头像昵称的显示，不当作菜不可用。
      settle(getProfiles(client, [authorId])).then((p) => {
        if (!cancelled) setAuthor(p.ok ? p.value.get(authorId) ?? null : null);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const crId = cr?.id;
  // 登录状态下查「我赞过没有」；登录 / 换账号后重查。
  useEffect(() => {
    if (!crId || !userId) return;
    let cancelled = false;
    settle(myLikes(getSupabase(), userId, [crId])).then((r) => {
      if (cancelled) return;
      if (r.ok) setLikedFor({ userId, liked: r.value.has(crId) });
      else if (r.reason === "unavailable") markUnavailable();
    });
    return () => {
      cancelled = true;
    };
  }, [crId, userId, markUnavailable]);

  const retry = () => {
    setPage({ status: "loading" });
    setAuthor(undefined);
    setAttempt((n) => n + 1);
  };

  const requireLogin = (): string | null => {
    if (!authReady) return null;
    if (!userId) {
      router.push("/sign-in");
      return null;
    }
    return userId;
  };

  const publicUrl = useCallback((path: string) => {
    return getSupabase().storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
  }, []);
  const imageUri = useCallback((image: StepImage) => (image.path ? publicUrl(image.path) : null), [publicUrl]);

  const recipe: Recipe | null = useMemo(() => (cr ? { ...cr.recipe, id: cr.id, custom: false } : null), [cr]);

  if (view.status !== "ready" || !cr || !recipe) {
    return <StatusScreen state={view} topInset={insets.top} onRetry={retry} />;
  }

  const isBuiltin = cr.builtin;
  const authorLoading = !isBuiltin && !!cr.authorId && author === undefined;
  const authorName = isBuiltin ? BRAND_NAME : author === undefined ? "" : author?.nickname || FALLBACK_NICKNAME;
  const favId = favoriteIdFor(cr, userId);
  const isFavorite = favorites.includes(favId);
  const showSave = canSaveToMine(cr, userId);
  const coverUri = cr.recipe.cover?.path && !coverFailed ? publicUrl(cr.recipe.cover.path) : null;
  const tint = recipe.art === "salad" ? colors.leafSoft : ART_TINTS[Math.abs(recipe.name.length) % ART_TINTS.length];

  const gallery: ViewerImage[] = [];
  if (coverUri) gallery.push({ key: cr.recipe.cover?.id ?? "cover", uri: coverUri, caption: recipe.name });
  recipe.steps.forEach((step, stepIndex) => {
    for (const image of step.images ?? []) {
      const uri = imageUri(image);
      if (uri) gallery.push({ key: image.id, uri, caption: `第 ${stepIndex + 1} 步 · ${step.text}` });
    }
  });
  const openViewer = (key: string) => {
    const at = gallery.findIndex((item) => item.key === key);
    if (at >= 0) setViewerIndex(at);
  };

  const onLike = async () => {
    if (likeBusy.current) return;
    const uid = requireLogin();
    if (!uid) return;
    likeBusy.current = true;
    setLiking(true);
    try {
      const client = getSupabase();
      let current = liked;
      if (current === null) {
        // 还不知道赞没赞过（刚登录 / 查询失败）：先查一次，不然可能多算一个赞。
        const mine = await settle(myLikes(client, uid, [cr.id]));
        if (!mine.ok) return onFail(mine.reason, "网络不太好，没发出去");
        if (likeAfterLookup(mine.value.has(cr.id)) === "sync") {
          // 其实已经赞过：只同步显示，不再发请求、不改计数。
          setLikedFor({ userId: uid, liked: true });
          return;
        }
        current = false;
      }
      const { next, rollback } = applyLikeToggle({ liked: current, count: likeCount });
      setLikedFor({ userId: uid, liked: next.liked });
      setLikeCount(next.count);
      if (next.liked) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const r = await settle(setLike(client, uid, cr.id, next.liked));
      if (!r.ok) {
        setLikedFor({ userId: uid, liked: rollback.liked });
        setLikeCount(rollback.count);
        onFail(r.reason, "网络不太好，没发出去");
      }
    } finally {
      likeBusy.current = false;
      setLiking(false);
    }
  };

  const onFavorite = () => {
    // 内置菜（和自己的菜）收藏的是本地 id，游客也能收藏；只有 community: 收藏需要登录。
    if (parseCommunityFavoriteId(favId) !== null && !requireLogin()) return;
    toggleFavorite(favId);
    if (isFavorite) show({ text: "已取消收藏", undo: () => toggleFavorite(favId) });
  };

  const onSave = async () => {
    if (saveBusy.current || authorLoading) return;
    if (!requireLogin()) return;
    saveBusy.current = true;
    setSaving(true);
    try {
      const r = await saveToMine(cr, authorName);
      if (!r.ok) {
        if (r.reason !== "unavailable") return onFail(r.reason);
        // 复制图片的 Storage 错误也会折成 unavailable：重新读一次菜，确认真的下架了才切页面。
        const again = await settle(getCommunityRecipe(getSupabase(), cr.id));
        if (!again.ok && again.reason === "unavailable") return markUnavailable();
        return showText("没存上，稍后再试");
      }
      showText("已存到我的菜谱");
      router.push(`/recipe/${r.recipeId}`);
    } finally {
      saveBusy.current = false;
      setSaving(false);
    }
  };

  const onComments = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, commentsY.current - insets.top - 64), animated: true });
    commentsHandle.current?.focus();
  };

  const onReportMenu = () => {
    setMenuOpen(false);
    if (!requireLogin()) return;
    setReporting(true);
  };

  const onReport = async (reason: ReportReason) => {
    setReporting(false);
    const uid = requireLogin();
    if (!uid) return;
    const r = await settle(report(getSupabase(), uid, { recipeId: cr.id }, reason));
    if (r.ok) showText("收到，我们会尽快处理");
    else onFail(r.reason);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.cover, { height: coverHeight, backgroundColor: tint }]}>
          <View style={[styles.overscroll, { backgroundColor: tint }]} />
          {coverUri ? (
            <Pressable
              onPress={() => openViewer(cr.recipe.cover?.id ?? "cover")}
              accessibilityRole="imagebutton"
              accessibilityLabel="查看封面大图"
              style={StyleSheet.absoluteFill}
            >
              <Image
                alt={recipe.name}
                source={{ uri: coverUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onError={() => setCoverFailed(true)}
              />
            </Pressable>
          ) : (
            <View style={{ marginTop: 24 }}>
              <FoodArt
                kind={recipe.art}
                size={Math.round(Math.min(windowWidth * 0.7, coverHeight * 0.72) * (recipe.art ? 1 : 0.6))}
                label={recipe.name}
              />
            </View>
          )}
        </View>

        <View style={styles.sheetBody}>
          <Animated.View entering={rise(0)}>
            <AppText size={28} weight="800" style={styles.title}>
              {recipe.name}
            </AppText>
            <AppText size={15} color={colors.muted} style={{ lineHeight: 22 }}>
              {recipeSubtitle(recipe)}
            </AppText>
          </Animated.View>

          <Animated.View entering={rise(1)} style={styles.authorRow}>
            <Avatar builtin={isBuiltin} uri={author?.avatarUrl ?? null} name={authorName} />
            <AppText size={15} weight="700" numberOfLines={1} style={{ flex: 1 }}>
              {authorName || " "}
            </AppText>
          </Animated.View>

          <RecipeBody
            recipe={recipe}
            imageUri={imageUri}
            servings={servings}
            onAdjustServings={(delta) => {
              const next = Math.min(6, Math.max(1, servings + delta));
              if (next !== servings) Haptics.selectionAsync().catch(() => {});
              setServings(next);
            }}
            checked={done}
            onToggleIngredient={(index) => {
              Haptics.selectionAsync().catch(() => {});
              setDone((current) => ({ ...current, [index]: !current[index] }));
            }}
            onPressImage={(image) => openViewer(image.id)}
          />
        </View>

        <View
          ref={commentsRef}
          style={styles.comments}
          onLayout={(event) => {
            commentsY.current = event.nativeEvent.layout.y;
          }}
        >
          <Comments
            ref={commentsHandle}
            communityRecipeId={cr.id}
            recipeAuthorId={cr.builtin ? null : cr.authorId}
            currentUserId={userId}
            commentCount={commentCount}
            requireLogin={requireLogin}
            onUnavailable={markUnavailable}
            onCountChange={(delta) => setCommentCount((n) => Math.max(0, n + delta))}
            toast={showText}
          />
        </View>
      </ScrollView>

      <View style={[styles.topBar, { paddingTop: insets.top }]} pointerEvents="box-none">
        <GlassButton label="返回" onPress={leave}>
          <BackIcon size={22} color={colors.ink} />
        </GlassButton>
        <View style={{ flex: 1 }} pointerEvents="none" />
        <GlassButton label="更多" onPress={() => setMenuOpen(true)}>
          <MoreIcon size={22} color={colors.ink} />
        </GlassButton>
      </View>

      <View style={styles.actionBar} pointerEvents="box-none">
        <LinearGradient
          colors={[`${colors.canvas}00`, colors.canvas, colors.canvas]}
          locations={[0, 0.3, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.actionRow, { paddingBottom: insets.bottom + (IS_ANDROID ? 16 : 12) }]}>
          <BarButton
            label={liked ? `取消点赞，当前 ${likeCount} 个赞` : `点赞，当前 ${likeCount} 个赞`}
            selected={Boolean(liked)}
            disabled={liking}
            onPress={onLike}
          >
            <ThumbIcon size={22} filled={Boolean(liked)} color={liked ? colors.accent : colors.ink} />
            <AppText size={12} weight="700" color={liked ? colors.accentText : colors.muted} style={styles.num}>
              {likeCount}
            </AppText>
          </BarButton>
          <BarButton label={isFavorite ? "取消收藏" : "收藏"} selected={isFavorite} onPress={onFavorite}>
            <HeartIcon size={22} filled={isFavorite} color={isFavorite ? colors.accent : colors.ink} />
            <AppText size={12} weight="700" color={colors.muted}>
              收藏
            </AppText>
          </BarButton>
          <BarButton label={`评论，共 ${commentCount} 条`} onPress={onComments}>
            <BubbleIcon size={22} color={colors.ink} />
            <AppText size={12} weight="700" color={colors.muted} style={styles.num}>
              {commentCount}
            </AppText>
          </BarButton>
          {showSave ? <SaveButton saving={saving} disabled={authorLoading} onPress={onSave} /> : null}
        </View>
      </View>

      <Toast toast={toast} bottom={insets.bottom + 96} onUndo={undo} />

      <ImageViewer images={gallery} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />

      {menuOpen ? (
        <ActionSheet
          actions={[{ label: "举报这道菜", danger: true, onPress: onReportMenu }]}
          onCancel={() => setMenuOpen(false)}
        />
      ) : null}
      {reporting ? (
        <ReportSheet title="举报这道菜" onSelect={onReport} onCancel={() => setReporting(false)} />
      ) : null}
    </View>
  );
}

/* ---------------- 加载中 / 出错 / 已下架 ---------------- */

function StatusScreen({
  state,
  topInset,
  onRetry,
}: {
  state: PageState;
  topInset: number;
  onRetry: () => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: topInset }]}>
        <GlassButton label="返回" onPress={leave}>
          <BackIcon size={22} color={colors.ink} />
        </GlassButton>
      </View>
      <View style={styles.center}>
        {state.status === "loading" ? (
          <ActivityIndicator color={colors.muted} />
        ) : state.status === "unavailable" ? (
          <>
            <AppText size={17} weight="800">这道菜已下架</AppText>
            <AppText size={13} color={colors.muted} style={styles.centerHint}>
              作者撤回了，或者它暂时不能看了
            </AppText>
            <Pressable onPress={leave} style={styles.centerBtn} accessibilityRole="button" accessibilityLabel="返回">
              <AppText size={14} weight="700" color={colors.white}>返回</AppText>
            </Pressable>
          </>
        ) : (
          <>
            <AppText size={17} weight="800">网络不太好</AppText>
            <AppText size={13} color={colors.muted} style={styles.centerHint}>
              这道菜暂时没加载出来
            </AppText>
            <Pressable onPress={onRetry} style={styles.centerBtn} accessibilityRole="button" accessibilityLabel="重试">
              <AppText size={14} weight="700" color={colors.white}>重试</AppText>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

/* ---------------- 小部件 ---------------- */

function Avatar({ builtin, uri, name }: { builtin: boolean; uri: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (builtin) {
    return <Image alt={BRAND_NAME} source={BRAND_MARK} style={styles.avatar} />;
  }
  if (uri && !failed) {
    return <Image alt={name} source={{ uri }} style={styles.avatar} onError={() => setFailed(true)} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <AppText size={15} weight="800" color={colors.accentText}>
        {Array.from(name)[0] ?? ""}
      </AppText>
    </View>
  );
}

function GlassButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const press = usePressScale(0.94);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
    >
      <Animated.View style={[styles.iconBtn, press.style]}>{children}</Animated.View>
    </Pressable>
  );
}

function BarButton({
  label,
  onPress,
  selected,
  disabled,
  children,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const press = usePressScale(0.92);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected }}
      hitSlop={4}
    >
      <Animated.View style={[styles.barBtn, press.style]}>{children}</Animated.View>
    </Pressable>
  );
}

function SaveButton({ saving, disabled, onPress }: { saving: boolean; disabled: boolean; onPress: () => void }) {
  const press = usePressScale();
  const off = saving || disabled;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel="存到我的菜谱"
      accessibilityState={{ disabled: off, busy: saving }}
      style={{ flex: 1 }}
    >
      <Animated.View style={[styles.saveBtn, off && { opacity: 0.7 }, press.style]}>
        {saving ? <ActivityIndicator color={colors.white} size="small" /> : null}
        <AppText size={16} weight="700" color={colors.white} numberOfLines={1}>
          存到我的菜谱
        </AppText>
      </Animated.View>
    </Pressable>
  );
}

/* ---------------- 本页专用图标（Icons.tsx 里没有） ---------------- */

function ThumbIcon({ color = colors.ink, size = 22, filled = false }: { color?: string; size?: number; filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 10.5v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H7zm0 0 3.6-6.3a1.6 1.6 0 0 1 2.9 1.1l-.6 3.7h5.2a2 2 0 0 1 2 2.3l-1.1 6.6a2 2 0 0 1-2 1.6H7"
        stroke={color}
        strokeWidth={1.9}
        strokeLinejoin="round"
        fill={filled ? color : "none"}
      />
    </Svg>
  );
}

function BubbleIcon({ color = colors.ink, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.4-4.4A7.5 7.5 0 1 1 20 11.5z"
        stroke={color}
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
    </Svg>
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
  num: { fontVariant: ["tabular-nums"] },

  cover: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  overscroll: { position: "absolute", left: 0, right: 0, top: -600, height: 600 },

  sheetBody: {
    marginTop: -36,
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: spacing.xl,
    paddingTop: 22,
  },
  title: { letterSpacing: -0.6, lineHeight: 34, marginTop: 10, marginBottom: 6 },
  authorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceAlt },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft },

  comments: { paddingHorizontal: spacing.xl, marginTop: spacing.xxl },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: ICON_BTN / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.78)",
  },

  actionBar: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 30 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  barBtn: { minWidth: 52, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 2 },
  saveBtn: {
    minHeight: 52,
    marginLeft: 6,
    borderRadius: IS_ANDROID ? radius.pill : 16,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.accent,
    ...shadow.card,
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  centerHint: { marginTop: 6, textAlign: "center" },
  centerBtn: {
    marginTop: spacing.lg,
    height: 42,
    paddingHorizontal: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    justifyContent: "center",
  },
});
