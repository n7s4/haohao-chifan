import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { AddToPlanSheet } from "../../components/AddToPlanSheet";
import { AppText } from "../../components/Common";
import { FoodArt } from "../../components/FoodArt";
import {
  BackIcon,
  CheckIcon,
  ClockIcon,
  FlameIcon,
  HeartIcon,
  StarIcon,
} from "../../components/Icons";
import { ART_TINTS } from "../../components/RecipeTile";
import { Toast, useToast } from "../../components/Toast";
import { type ArtKind, type Recipe, recipeSubtitle } from "../../data/recipes";
import { useStore } from "../../state/store";
import { ImageViewer, type ViewerImage } from "../../components/ImageViewer";
import { RecipeBody, rise } from "../../components/recipe/RecipeBody";
import { useMediaUris } from "../../lib/useMedia";
import { colors, motion, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;
const BTN_RADIUS = IS_ANDROID ? radius.pill : 16;
const FLYER = 64;

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  // 设计稿封面 380；小屏（SE 667）上按屏高比例收到 300，白卡别被挤到只剩两三行。
  const coverHeight = Math.round(Math.min(380, Math.max(300, windowHeight * 0.46)));
  const { favorites, toggleFavorite, servings: servingsMap, setServings, ratings, findRecipe } = useStore();
  const recipe = findRecipe(id);
  const myRating = ratings[recipe?.id ?? ""] ?? 0;
  const servings = servingsMap[recipe?.id ?? ""] ?? 1;
  const adjustServings = (delta: number) => {
    if (!recipe) return;
    const next = Math.min(6, Math.max(1, servings + delta));
    if (next !== servings) Haptics.selectionAsync().catch(() => {});
    setServings(recipe.id, servings + delta);
  };
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [addingToPlan, setAddingToPlan] = useState(false);
  /** 刚放进计划的落点（「周五晚餐」）；有值时「加入计划」按钮变成叶子绿的完成态。 */
  const [planned, setPlanned] = useState<string | null>(null);
  const [flight, setFlight] = useState<{ from: Point; to: Point; key: number } | null>(null);
  const { toast, show, undo: undoReplace } = useToast();

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  const addBtnFrame = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const footerY = useRef(0);
  const flightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLanding = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (flightTimer.current) clearTimeout(flightTimer.current);
    },
    []
  );

  const mediaUris = useMediaUris(recipe?.id, [
    recipe?.cover,
    ...(recipe?.steps.flatMap((step) => step.images ?? []) ?? []),
  ]);
  const coverUri = recipe?.cover ? recipe.cover.localUri ?? mediaUris[recipe.cover.id] : undefined;
  /** 大图查看：封面 + 各步骤图排成一组，左右滑着看。 */
  const gallery: ViewerImage[] = [];
  if (recipe && coverUri) gallery.push({ key: recipe.cover?.id ?? "cover", uri: coverUri, caption: recipe.name });
  recipe?.steps.forEach((step, stepIndex) => {
    for (const image of step.images ?? []) {
      const uri = image.localUri ?? mediaUris[image.id];
      if (uri) gallery.push({ key: image.id, uri, caption: `第 ${stepIndex + 1} 步 · ${step.text}` });
    }
  });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const openViewer = (key: string) => {
    const at = gallery.findIndex((item) => item.key === key);
    if (at >= 0) setViewerIndex(at);
  };

  if (!recipe) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 40, paddingHorizontal: 24 }]}>
        <AppText size={16} weight="700">没有找到这道菜</AppText>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <AppText size={14} color={colors.accentText}>返回</AppText>
        </Pressable>
      </View>
    );
  }

  const isFavorite = favorites.includes(recipe.id);
  const tint = recipe.art === "salad" ? colors.leafSoft : ART_TINTS[Math.abs(recipe.name.length) % ART_TINTS.length];

  const land = (label: string, message: string, undo?: () => void) => {
    setFlight(null);
    setPlanned(label);
    // 撤销替换时按钮也退回「加入计划」，不留一个已经不成立的完成态。
    const wrappedUndo = undo
      ? () => {
          undo();
          setPlanned(null);
        }
      : undefined;
    show(wrappedUndo ? { text: message, undo: wrappedUndo } : { text: message });
  };

  const onPlaced = (message: string, undo?: () => void, placed?: { day: string; slot: string }) => {
    setAddingToPlan(false);
    const label = placed ? `${placed.day}${placed.slot}` : "已加入";
    const frame = addBtnFrame.current;
    if (reduced || !frame) {
      land(label, message, undo);
      return;
    }
    // 等面板退场（300ms）再起飞：一盘菜沿抛物线从封面落进「加入计划」按钮。
    const from = { x: windowWidth / 2, y: Math.max(insets.top + 80, coverHeight * 0.5 - scrollY.get()) };
    const to = { x: frame.x + frame.width / 2, y: footerY.current + frame.y + frame.height / 2 };
    pendingLanding.current = () => land(label, message, undo);
    if (flightTimer.current) clearTimeout(flightTimer.current);
    flightTimer.current = setTimeout(() => setFlight({ from, to, key: Date.now() }), 260);
  };

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <Cover
          recipe={recipe}
          height={coverHeight}
          width={windowWidth}
          tint={tint}
          coverUri={coverUri}
          scrollY={scrollY}
          reduced={reduced}
          onPressPhoto={() => openViewer(recipe.cover?.id ?? "cover")}
        />

        <View style={styles.sheetBody}>
          {recipe.tags.length || myRating ? (
            <Animated.View entering={rise(0)} style={styles.tags}>
              {recipe.tags.map((tag, index) => (
                <View key={tag} style={[styles.tag, index ? styles.tagLeaf : styles.tagTomato]}>
                  <AppText size={12} weight="600" color={index ? colors.leafText : colors.accentText}>
                    {tag}
                  </AppText>
                </View>
              ))}
              {myRating ? (
                <View style={[styles.tag, styles.tagSun]}>
                  <StarIcon size={11} filled color={colors.sunText} />
                  <AppText size={12} weight="600" color={colors.sunText}>
                    我评 {myRating} 星
                  </AppText>
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          <Animated.View entering={rise(1)}>
            <AppText size={28} weight="800" style={styles.title}>
              {recipe.name}
            </AppText>
            <AppText size={15} color={colors.muted} style={{ lineHeight: 22 }}>
              {recipeSubtitle(recipe)}
            </AppText>
          </Animated.View>

          <Animated.View entering={rise(2)} style={styles.stats}>
            <Stat
              icon={<ClockIcon size={20} color={colors.accent} />}
              value={recipe.minutes > 0 ? `${recipe.minutes}` : "—"}
              label="分钟"
            />
            <Stat
              icon={<GaugeIcon size={20} color={colors.leafText} />}
              value={recipe.difficulty || "—"}
              label="难度"
            />
            <Stat
              icon={<FlameIcon size={20} color={colors.sunText} />}
              value={recipe.calories > 0 ? `${recipe.calories}` : "—"}
              label="千卡 / 份"
            />
          </Animated.View>

          <RecipeBody
            recipe={recipe}
            imageUri={(image) => image.localUri ?? mediaUris[image.id] ?? null}
            servings={servings}
            onAdjustServings={adjustServings}
            checked={done}
            onToggleIngredient={(index) => {
              Haptics.selectionAsync().catch(() => {});
              setDone((current) => ({ ...current, [index]: !current[index] }));
            }}
            onPressImage={(image) => openViewer(image.id)}
          />
        </View>
      </Animated.ScrollView>

      <FloatBar
        title={recipe.name}
        topInset={insets.top}
        coverHeight={coverHeight}
        scrollY={scrollY}
        isFavorite={isFavorite}
        onToggleFavorite={() => {
          toggleFavorite(recipe.id);
          if (isFavorite) show({ text: "已取消收藏", undo: () => toggleFavorite(recipe.id) });
        }}
        onEdit={
          recipe.custom
            ? () => router.push({ pathname: "/create-recipe", params: { id: recipe.id } })
            : undefined
        }
      />

      <View
        style={styles.actionBar}
        pointerEvents="box-none"
        onLayout={(event) => {
          footerY.current = event.nativeEvent.layout.y;
        }}
      >
        <LinearGradient
          colors={[`${colors.canvas}00`, colors.canvas, colors.canvas]}
          locations={[0, 0.3, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.actionRow, { paddingBottom: insets.bottom + (IS_ANDROID ? 16 : 12) }]}>
          <View
            style={{ flex: 1 }}
            onLayout={(event) => {
              addBtnFrame.current = event.nativeEvent.layout;
            }}
          >
            <AddButton planned={planned} onPress={() => setAddingToPlan(true)} />
          </View>
          <View style={{ flex: 1.4 }}>
            <Squish
              onPress={() => router.push(`/cook/${recipe.id}`)}
              label="开始做饭"
              style={[styles.btn, styles.btnPrimary]}
            >
              <AppText size={16} weight="700" color={colors.white}>
                开始做饭
              </AppText>
            </Squish>
          </View>
        </View>
      </View>

      {flight ? (
        <Flyer
          key={flight.key}
          kind={recipe.art}
          label={recipe.name}
          from={flight.from}
          to={flight.to}
          onDone={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            const next = pendingLanding.current;
            pendingLanding.current = null;
            if (next) next();
            else setFlight(null);
          }}
        />
      ) : null}

      <Toast toast={toast} bottom={insets.bottom + 96} onUndo={undoReplace} />

      <ImageViewer images={gallery} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />

      {addingToPlan ? (
        <AddToPlanSheet
          recipeId={recipe.id}
          onClose={() => setAddingToPlan(false)}
          onDone={onPlaced}
        />
      ) : null}
    </View>
  );
}

type Point = { x: number; y: number };

/* ---------------- 封面：插画视差 + 冒热气 ---------------- */

function Cover({
  recipe,
  height,
  width,
  tint,
  coverUri,
  scrollY,
  reduced,
  onPressPhoto,
}: {
  recipe: Recipe;
  height: number;
  width: number;
  tint: string;
  coverUri?: string;
  scrollY: SharedValue<number>;
  reduced: boolean;
  onPressPhoto: () => void;
}) {
  const isPhoto = Boolean(coverUri);
  const artSize = Math.round(Math.min(width * 0.78, height * 0.8));
  // 设计稿：往上滚时盘子慢半拍下沉、轻微放大并转起来；下拉回弹时放大。照片不转。
  const parallax = useAnimatedStyle(() => {
    if (reduced) return {};
    const y = scrollY.value;
    if (y < 0) return { transform: [{ translateY: y / 2 }, { scale: 1 - y / 300 }] };
    return {
      transform: [
        { translateY: y * 0.45 },
        { scale: 1 + y / 1600 },
        { rotate: isPhoto ? "0deg" : `${y / 12}deg` },
      ],
    };
  });

  return (
    <View style={[styles.cover, { height, backgroundColor: tint }]}>
      {/* 下拉回弹时露出的是同色底，不是一条白缝。 */}
      <View style={[styles.overscroll, { backgroundColor: tint }]} />
      {isPhoto ? (
        <Animated.View style={[StyleSheet.absoluteFill, parallax]}>
          <Pressable
            onPress={onPressPhoto}
            accessibilityRole="imagebutton"
            accessibilityLabel="查看封面大图"
            style={StyleSheet.absoluteFill}
          >
            <Image alt={recipe.name} source={{ uri: coverUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          </Pressable>
        </Animated.View>
      ) : (
        <>
          <View style={[styles.confetti, { top: height * 0.2, left: width * 0.15, width: 10, height: 10, backgroundColor: colors.sun }]} />
          <View style={[styles.confetti, { top: height * 0.28, right: width * 0.14, width: 8, height: 8, backgroundColor: colors.leaf }]} />
          <View style={[styles.confetti, { bottom: height * 0.2, right: width * 0.15, width: 6, height: 6, backgroundColor: colors.accent }]} />
          <Animated.View
            style={[styles.coverArt, { transformOrigin: "50% 70%" }, parallax]}
            accessibilityRole="image"
            accessibilityLabel={recipe.name}
          >
            <View style={{ marginTop: 24 }}>
              <FoodArt kind={recipe.art} size={recipe.art ? artSize : Math.round(artSize * 0.6)} label={recipe.name} />
            </View>
            {recipe.art ? <Steam size={artSize} reduced={reduced} /> : null}
          </Animated.View>
        </>
      )}
    </View>
  );
}

const STEAM_PATHS = ["M98 52c-8-10 8-15 0-27", "M120 46c-8-10 8-15 0-27", "M142 52c-8-10 8-15 0-27"];

/** 盘子上方三缕热气，错开 0.9s 循环；减少动态效果时整组不画。 */
function Steam({ size, reduced }: { size: number; reduced: boolean }) {
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center" }]}>
      {STEAM_PATHS.map((d, index) => (
        <SteamWisp key={d} d={d} index={index} size={size} />
      ))}
    </View>
  );
}

function SteamWisp({ d, index, size }: { d: string; index: number; size: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(
      withDelay(index * 900, withRepeat(withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.quad) }), -1))
    );
  }, [index, t]);
  const k = size / 240;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.35, 1], [0, 0.9, 0]),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [8, -16]) * k },
      { scaleY: interpolate(t.value, [0, 1], [0.7, 1.1]) },
    ],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { alignItems: "center", marginTop: -size * 0.04 }, style]}>
      <Svg width={size} height={size} viewBox="0 0 240 240">
        <Path d={d} stroke={colors.white} strokeWidth={7} fill="none" strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

/* ---------------- 顶栏：玻璃按钮，滚过封面后长出白底和菜名 ---------------- */

function FloatBar({
  title,
  topInset,
  coverHeight,
  scrollY,
  isFavorite,
  onToggleFavorite,
  onEdit,
}: {
  title: string;
  topInset: number;
  coverHeight: number;
  scrollY: SharedValue<number>;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onEdit?: () => void;
}) {
  const threshold = coverHeight - 80;
  const barBg = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [threshold - 40, threshold], [0, 1], "clamp"),
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [threshold - 20, threshold + 10], [0, 1], "clamp"),
    transform: [{ translateY: interpolate(scrollY.value, [threshold - 20, threshold + 10], [6, 0], "clamp") }],
  }));
  const glass = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      scrollY.value,
      [threshold - 40, threshold],
      ["rgba(255,255,255,0.78)", "rgba(255,255,255,0)"]
    ),
  }));

  return (
    <View style={[styles.floatBar, { paddingTop: topInset }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.floatBarBg, barBg]} pointerEvents="none" />
      <View style={styles.floatRow} pointerEvents="box-none">
        <Squish onPress={() => router.back()} label="返回" style={[styles.iconBtn, glass]}>
          {IS_ANDROID ? <ArrowLeftIcon size={22} color={colors.ink} /> : <BackIcon size={22} color={colors.ink} />}
        </Squish>
        <Animated.View style={[{ flex: 1 }, titleStyle]} pointerEvents="none">
          <AppText
            size={IS_ANDROID ? 18 : 16}
            weight="700"
            numberOfLines={1}
            style={{ textAlign: IS_ANDROID ? "left" : "center", paddingHorizontal: 4 }}
          >
            {title}
          </AppText>
        </Animated.View>
        {onEdit ? (
          <Squish onPress={onEdit} label="编辑这道菜" style={[styles.iconBtn, glass]}>
            <PencilIcon size={20} color={colors.ink} />
          </Squish>
        ) : null}
        <HeartButton active={isFavorite} onPress={onToggleFavorite} glass={glass} />
      </View>
    </View>
  );
}

function HeartButton({
  active,
  onPress,
  glass,
}: {
  active: boolean;
  onPress: () => void;
  glass: ReturnType<typeof useAnimatedStyle>;
}) {
  const pop = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Squish
      onPress={() => {
        if (!active) {
          pop.set(withSequence(withTiming(1.35, { duration: 160 }), withSpring(1, motion.spring)));
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onPress();
      }}
      label={active ? "取消收藏" : "收藏"}
      style={[styles.iconBtn, glass]}
      selected={active}
    >
      <Animated.View style={style}>
        <HeartIcon size={22} filled={active} color={active ? colors.accent : colors.ink} />
      </Animated.View>
    </Squish>
  );
}

/* ---------------- 小部件 ---------------- */

/** 按下缩小、松手弹回（设计稿 .btn:active / .icon-btn:active）。 */
function Squish({
  onPress,
  label,
  style,
  children,
  disabled,
  selected,
  scaleTo = 0.94,
}: {
  onPress: () => void;
  label: string;
  style?: React.ComponentProps<typeof Animated.View>["style"];
  children: React.ReactNode;
  disabled?: boolean;
  selected?: boolean;
  scaleTo?: number;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => scale.set(withTiming(scaleTo, { duration: 90 }))}
      onPressOut={() => scale.set(withSpring(1, motion.spring))}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected }}
      hitSlop={4}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      {icon}
      <AppText size={19} weight="800" numberOfLines={1} style={{ marginTop: 6, fontVariant: ["tabular-nums"] }}>
        {value}
      </AppText>
      <AppText size={12} color={colors.muted} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/** 「加入计划」：放进去之后变成叶子绿 + ✓ 落点，并弹一下（设计稿 #add.done）。 */
function AddButton({ planned, onPress }: { planned: string | null; onPress: () => void }) {
  const bump = useSharedValue(1);
  useEffect(() => {
    if (!planned) return;
    bump.set(withSequence(withTiming(0.9, { duration: 120 }), withSpring(1.06, motion.spring), withSpring(1, motion.spring)));
  }, [planned, bump]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  return (
    <Animated.View style={style}>
      <Squish
        onPress={onPress}
        label={planned ? `已放进${planned}，再加入计划` : "加入计划"}
        style={[styles.btn, planned ? styles.btnDone : styles.btnGhost]}
      >
        {planned ? <CheckIcon size={16} color={colors.leafText} /> : null}
        <AppText size={16} weight="700" color={planned ? colors.leafText : colors.ink} numberOfLines={1}>
          {planned ?? "加入计划"}
        </AppText>
      </Squish>
    </Animated.View>
  );
}

/** 一盘菜沿二次贝塞尔抛物线飞进按钮，边飞边缩小、旋转（设计稿 HH.fly）。 */
function Flyer({
  kind,
  label,
  from,
  to,
  onDone,
}: {
  kind?: ArtKind;
  label: string;
  from: Point;
  to: Point;
  onDone: () => void;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(
      withTiming(1, { duration: 820, easing: Easing.bezier(0.45, 0, 0.25, 1) }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
    // 只在挂载时起飞一次；onDone 每次渲染都是新函数，不能进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  const peak = Math.min(from.y, to.y) - 120;
  const style = useAnimatedStyle(() => {
    const p = t.value;
    const x = from.x + (to.x - from.x) * p;
    const y = (1 - p) * (1 - p) * from.y + 2 * (1 - p) * p * peak + p * p * to.y;
    return {
      opacity: p > 0.92 ? 0 : 1,
      transform: [
        { translateX: x - FLYER / 2 },
        { translateY: y - FLYER / 2 },
        { scale: 1.5 - p * 1.1 },
        { rotate: `${p * 300}deg` },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.flyer, style]}>
      <FoodArt kind={kind} size={FLYER} label={label} />
    </Animated.View>
  );
}

/* ---------------- 本页专用图标（Icons.tsx 里没有） ---------------- */

function GaugeIcon({ color = colors.ink, size = 20 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4.2 17.5a8.5 8.5 0 1 1 15.6 0" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="m12 14 3.6-4.6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={12} cy={14.2} r={1.6} fill={color} />
    </Svg>
  );
}

function ArrowLeftIcon({ color = colors.ink, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M19 12H5m6-6.5L4.5 12l6.5 6.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function PencilIcon({ color = colors.ink, size = 20 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 19.5h4l10-10a2.83 2.83 0 0 0-4-4l-10 10v4z"
        stroke={color}
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
      <Path d="m13.5 6.5 4 4" stroke={color} strokeWidth={1.9} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },

  cover: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  overscroll: { position: "absolute", left: 0, right: 0, top: -600, height: 600 },
  coverArt: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  confetti: { position: "absolute", borderRadius: 999, opacity: 0.7 },

  sheetBody: {
    marginTop: -36,
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: spacing.xl,
    paddingTop: 22,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  tag: {
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tagTomato: { backgroundColor: colors.accentSoft },
  tagLeaf: { backgroundColor: colors.leafSoft },
  tagSun: { backgroundColor: colors.sunSoft },
  title: { letterSpacing: -0.6, lineHeight: 34, marginTop: 10, marginBottom: 6 },

  stats: { flexDirection: "row", gap: spacing.sm, marginTop: 18, marginBottom: 6 },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow.card,
  },

  floatBar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  floatBarBg: {
    backgroundColor: "rgba(255,255,255,0.94)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  floatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: ICON_BTN / 2,
    alignItems: "center",
    justifyContent: "center",
  },

  actionBar: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 30 },
  actionRow: { flexDirection: "row", gap: 10, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  btn: {
    minHeight: 52,
    borderRadius: BTN_RADIUS,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  btnGhost: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.canvas },
  btnDone: { borderWidth: 1.5, borderColor: colors.leafSoft, backgroundColor: colors.leafSoft },

  flyer: { position: "absolute", left: 0, top: 0, width: FLYER, height: FLYER, zIndex: 200 },
});
