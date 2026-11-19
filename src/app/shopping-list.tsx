/**
 * 采购清单（对应 ../../../app-redesign/shopping.html）。
 *
 * 标志性动效：勾掉一样食材，顶部插画菜篮就多装满一点、轻轻颠一下；
 * 勾选的行先画勾、再向右滑出，落进下方「已购买」。
 * 系统开了「减少动态效果」时，菜篮直接跳到对应高度，不颠、不滑。
 */
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  FadeOutRight,
  LinearTransition,
  ZoomIn,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Ellipse, G, Path } from "react-native-svg";

import { AppText } from "../components/Common";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CloseIcon, PlusIcon, TrashIcon } from "../components/Icons";
import { categoryOf, ingredientCategories } from "../data/categories";
import { addDays, startOfWeek, toKey, useStore } from "../state/store";
import type { ShoppingItem } from "../state/store";
import { colors, motion, radius, shadow, spacing } from "../theme";

const IS_ANDROID = Platform.OS === "android";
/** Android（Material 3）按钮是全圆角胶囊，iOS 用圆角矩形。 */
const BTN_RADIUS = IS_ANDROID ? radius.pill : radius.md;

const stepOf = (unit: string) => (unit === "g" || unit === "ml" ? 10 : 1);
const HALVABLE = ["片", "瓣"];
const minOf = (unit: string) => {
  if (unit === "g" || unit === "ml") return 5;
  return HALVABLE.includes(unit) ? 0.5 : 1;
};
const clampQty = (unit: string, value: number) =>
  Number(Math.max(minOf(unit), value).toFixed(2));

/** 分组色块：蔬菜绿、肉蛋奶红、主食黄、调味蓝，其他灰。 */
const GROUP_COLOR: Record<string, string> = {
  蔬菜: colors.leaf,
  肉蛋奶: colors.accent,
  主食: colors.sun,
  调味: colors.sky,
  其他: colors.disabled,
};

/** 勾选后先画勾，停这么久再落进「已购买」。 */
const FLIP_DELAY = 320;

/* ---------------- 本地图标 ---------------- */

function ShareIcon({ color = colors.ink, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Material 风格的返回箭头（Android 用；iOS 是模态弹出，用关闭叉）。 */
function ArrowBackIcon({ color = colors.ink, size = 22 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M19 12H5M11 6l-6 6 6 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ChevronIcon({ color = colors.muted, size = 16 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m9 5 7 7-7 7" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/* ---------------- 插画菜篮 ---------------- */

const BASKET_W = 96;
const BASKET_H = 86;
/** 篮子空的时候，食材整体下沉的距离（和设计稿一致）。 */
const BASKET_DROP = 34;

/** 菜篮里的食材（插画专用色）。 */
function BasketProduce() {
  return (
    <Svg width={BASKET_W} height={BASKET_H} viewBox="0 0 96 86">
      <G>
        <Circle cx={30} cy={40} r={11} fill={colors.accent} />
        <Ellipse cx={54} cy={36} rx={13} ry={8} fill={colors.sun} transform="rotate(-20 54 36)" />
        <Circle cx={68} cy={44} r={10} fill="#F7943C" />
        <Ellipse cx={44} cy={30} rx={6} ry={12} fill="#8BD07E" transform="rotate(25 44 30)" />
        <Path d="M30 29c1-3 3-4 5-4" stroke={colors.leafText} strokeWidth={2.4} strokeLinecap="round" fill="none" />
        <Circle cx={26} cy={36} r={2.6} fill="#FFFFFF" opacity={0.45} />
      </G>
    </Svg>
  );
}

/** 篮身 + 提手，叠在食材上面。 */
function BasketFront({ lineColor }: { lineColor: string }) {
  return (
    <Svg width={BASKET_W} height={BASKET_H} viewBox="0 0 96 86" style={StyleSheet.absoluteFill}>
      <Path d="M8 44h80l-8 34a6 6 0 0 1-6 5H22a6 6 0 0 1-6-5z" fill={colors.white} />
      <Path d="M28 54v18M48 54v18M68 54v18" stroke={lineColor} strokeWidth={4} strokeLinecap="round" opacity={0.35} />
      <Path d="M26 44 40 16M70 44 56 16" stroke={colors.white} strokeWidth={5} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function Basket({
  progress,
  bumpKey,
  lineColor = colors.leafText,
}: {
  progress: number;
  bumpKey: number;
  lineColor?: string;
}) {
  const reduced = useReducedMotion();
  const fill = useSharedValue(reduced ? progress : 0);
  const bump = useSharedValue(0);

  useEffect(() => {
    fill.set(reduced ? progress : withSpring(progress, motion.springSoft));
  }, [progress, reduced, fill]);

  useEffect(() => {
    if (bumpKey === 0 || reduced) return;
    bump.set(withSequence(withTiming(1, { duration: 130 }), withSpring(0, motion.spring)));
  }, [bumpKey, reduced, bump]);

  const produceStyle = useAnimatedStyle(() => ({
    // 平方曲线：头一两样就让食材冒出篮口，越往后越慢，满篮时正好顶到位。
    transform: [{ translateY: (1 - fill.get()) * (1 - fill.get()) * BASKET_DROP }],
  }));
  const bodyStyle = useAnimatedStyle(() => {
    const b = bump.get();
    return {
      transform: [
        { translateY: interpolate(b, [0, 1], [0, 3]) },
        { scaleX: interpolate(b, [0, 1], [1, 1.08]) },
        { scaleY: interpolate(b, [0, 1], [1, 0.92]) },
        { rotate: `${interpolate(b, [0, 1], [0, -4])}deg` },
      ],
    };
  });

  return (
    <Animated.View style={[styles.basket, bodyStyle]} pointerEvents="none">
      {/* 只裁掉篮底以下，避免空篮时食材从篮底漏出来；上沿不裁，满篮时食材能冒出篮口 */}
      <View style={styles.basketClip}>
        <Animated.View style={[styles.produce, produceStyle]}>
          <BasketProduce />
        </Animated.View>
      </View>
      <BasketFront lineColor={lineColor} />
    </Animated.View>
  );
}

/* ---------------- 勾选圈 ---------------- */

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_LEN = 20;

function CheckBubble({ on }: { on: boolean }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(on ? 1 : 0);

  useEffect(() => {
    p.set(reduced ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: motion.duration.base }));
  }, [on, reduced, p]);

  const boxStyle = useAnimatedStyle(() => {
    const v = p.get();
    return {
      backgroundColor: interpolateColor(v, [0, 1], [colors.surface, colors.leaf]),
      borderColor: interpolateColor(v, [0, 1], [colors.border, colors.leaf]),
      transform: [{ scale: interpolate(v, [0, 0.6, 1], [1, 1.16, 1.06]) }],
    };
  });
  const pathProps = useAnimatedProps(() => ({
    strokeDashoffset: (1 - p.get()) * CHECK_LEN,
  }));

  return (
    <Animated.View style={[styles.check, boxStyle]}>
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <AnimatedPath
          d="m5 12.5 4.5 4.5L19 7.5"
          stroke={colors.white}
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECK_LEN}
          animatedProps={pathProps}
        />
      </Svg>
    </Animated.View>
  );
}

/* ---------------- 单行 ---------------- */

function ShopRow({
  item,
  checked,
  first,
  editing,
  qtyDraft,
  onToggle,
  onStartEdit,
  onDraft,
  onCommitDraft,
  onStep,
  onRemove,
}: {
  item: ShoppingItem;
  checked: boolean;
  first: boolean;
  editing: boolean;
  qtyDraft: string;
  onToggle: () => void;
  onStartEdit: () => void;
  onDraft: (value: string) => void;
  onCommitDraft: () => void;
  onStep: (dir: 1 | -1) => void;
  onRemove: () => void;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(motion.duration.slow)}
      exiting={FadeOutRight.duration(motion.duration.slow)}
      layout={LinearTransition.springify().damping(20).stiffness(160)}
      style={[styles.row, !first && styles.rowDivider]}
    >
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.7 }]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={item.name}
        hitSlop={{ top: 6, bottom: 6 }}
      >
        <CheckBubble on={checked} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText
            size={15}
            weight="600"
            color={checked ? colors.placeholder : colors.ink}
            style={checked ? { textDecorationLine: "line-through" } : undefined}
            numberOfLines={1}
          >
            {item.name}
          </AppText>
          {item.sources.length > 0 ? (
            <AppText size={12} color={colors.muted} style={{ marginTop: 2 }} numberOfLines={1}>
              {item.sources.join(" · ")}
            </AppText>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.stepper}>
        <Pressable
          hitSlop={6}
          onPress={() => onStep(-1)}
          disabled={item.qty === null}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="减少数量"
        >
          <AppText size={16} weight="700" color={item.qty === null ? colors.disabled : colors.muted}>−</AppText>
        </Pressable>
        {editing && item.qty !== null ? (
          <TextInput
            value={qtyDraft}
            onChangeText={onDraft}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onBlur={onCommitDraft}
            onSubmitEditing={onCommitDraft}
            style={styles.qtyInput}
          />
        ) : (
          <Pressable
            hitSlop={4}
            onPress={onStartEdit}
            accessibilityRole="button"
            accessibilityLabel={item.qty === null ? item.unit : `修改数量，当前 ${item.qty} ${item.unit}`}
          >
            <AppText
              size={13}
              weight="700"
              color={checked ? colors.placeholder : colors.ink}
              style={styles.qtyText}
              numberOfLines={1}
            >
              {item.qty === null ? item.unit : `${item.qty} ${item.unit}`}
            </AppText>
          </Pressable>
        )}
        <Pressable
          hitSlop={6}
          onPress={() => onStep(1)}
          style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="增加数量"
        >
          <AppText size={16} weight="700" color={colors.muted}>+</AppText>
        </Pressable>
      </View>

      <Pressable
        onPress={onRemove}
        hitSlop={8}
        style={({ pressed }) => [styles.trash, pressed && { backgroundColor: colors.accentSoft }]}
        accessibilityRole="button"
        accessibilityLabel={`移除 ${item.name}`}
      >
        <TrashIcon size={15} color={colors.placeholder} />
      </Pressable>
    </Animated.View>
  );
}

/* ---------------- 折叠头（已购买 / 已移除） ---------------- */

function FoldHead({
  open,
  label,
  a11y,
  onPress,
}: {
  open: boolean;
  label: string;
  a11y: string;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const rot = useSharedValue(open ? 90 : 0);
  useEffect(() => {
    rot.set(reduced ? (open ? 90 : 0) : withSpring(open ? 90 : 0, motion.springSoft));
  }, [open, reduced, rot]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.get()}deg` }] }));
  return (
    <Pressable
      onPress={onPress}
      style={styles.foldHead}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={a11y}
    >
      <Animated.View style={iconStyle}>
        <ChevronIcon />
      </Animated.View>
      <AppText size={14} weight="700" color={colors.muted}>{label}</AppText>
    </Pressable>
  );
}

/* ---------------- 屏幕 ---------------- */

type ToastMsg = { id: number; text: string; action?: { label: string; run: () => void } };

export default function ShoppingListScreen() {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const {
    shoppingItems,
    missingRecipeCount,
    toggleChecked,
    setQty,
    addManualItem,
    removeItem,
    removedItems,
    restoreRemoved,
    resetChecked,
    weekDays,
    trippedCount,
    carryPending,
    undoCarry,
    carriedCount,
    weekKey,
  } = useStore();
  const [toast, setToastState] = useState<ToastMsg | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [carryOpen, setCarryOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const [name, setName] = useState("");
  const [qty, setQtyInput] = useState("");
  const [unit, setUnit] = useState("g");
  const [nameFocused, setNameFocused] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState("");
  /** 刚点过、还在「画勾」阶段的行，先在原位显示新状态，过一会儿再真正切换。 */
  const [flipping, setFlipping] = useState<string[]>([]);
  const [bumpKey, setBumpKey] = useState(0);
  const [footerH, setFooterH] = useState(120);

  const isCurrentWeek = weekKey === toKey(startOfWeek(new Date()));
  const isNextWeek = weekKey === toKey(addDays(startOfWeek(new Date()), 7));
  const title = isCurrentWeek ? "本周采购清单" : isNextWeek ? "下周采购清单" : "采购清单";
  const range = `${weekDays[0].slice(5).replace("-", "/")} – ${weekDays[6].slice(5).replace("-", "/")}`;

  const pending = useMemo(() => shoppingItems.filter((item) => !item.checked), [shoppingItems]);
  const bought = useMemo(() => shoppingItems.filter((item) => item.checked), [shoppingItems]);
  const [showBought, setShowBought] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof shoppingItems>();
    pending.forEach((item) => {
      const key = categoryOf(item.name);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    });
    return ingredientCategories
      .map((category) => ({ category, items: map.get(category) ?? [] }))
      .filter((group) => group.items.length > 0);
  }, [pending]);

  const total = shoppingItems.length;
  const progress = total ? trippedCount / total : 0;
  const allBought = total > 0 && pending.length === 0;

  useEffect(() => {
    const timers = flipTimers.current;
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  /* 加号的抖动：空名提交时左右晃两下 */
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));

  const showToast = (text: string, action?: ToastMsg["action"]) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState((prev) => ({ id: (prev?.id ?? 0) + 1, text, action }));
    toastTimer.current = setTimeout(() => setToastState(null), action ? 4200 : 2600);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setAddError("先写下要买什么");
      if (!reduced) {
        shake.set(
          withSequence(
            withTiming(-8, { duration: 50 }),
            withTiming(8, { duration: 70 }),
            withTiming(-5, { duration: 60 }),
            withTiming(0, { duration: 60 })
          )
        );
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    const parsed = Number(qty);
    addManualItem(trimmed, Number.isFinite(parsed) && parsed > 0 ? parsed : null, unit.trim() || "份");
    setName("");
    setQtyInput("");
    setAddError(null);
    Haptics.selectionAsync().catch(() => {});
    showToast(`已添加 ${trimmed}`);
  };

  const toggle = (item: ShoppingItem) => {
    if (flipping.includes(item.id)) return;
    const willCheck = !item.checked;
    Haptics.selectionAsync().catch(() => {});
    setFlipping((list) => [...list, item.id]);
    const timer = setTimeout(() => {
      flipTimers.current.delete(item.id);
      setFlipping((list) => list.filter((id) => id !== item.id));
      toggleChecked(item.id);
      if (willCheck) {
        setBumpKey((k) => k + 1);
        if (pending.length === 1 && pending[0].id === item.id) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      }
    }, reduced ? 0 : FLIP_DELAY);
    flipTimers.current.set(item.id, timer);
  };

  const commitDraft = (item: ShoppingItem) => {
    const parsed = Number(qtyDraft.replace(",", "."));
    if (qtyDraft.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
      setQty(item.id, clampQty(item.unit, parsed));
    }
    setEditingQty(null);
  };

  const step = (item: ShoppingItem, dir: 1 | -1) => {
    if (dir < 0) {
      if (item.qty === null) return;
      const next = Number((item.qty - stepOf(item.unit)).toFixed(2));
      setQty(item.id, clampQty(item.unit, next));
    } else {
      const next = Number(((item.qty ?? 0) + stepOf(item.unit)).toFixed(2));
      setQty(item.id, clampQty(item.unit, next));
    }
  };

  const remove = (item: ShoppingItem) => {
    const manual = item.id.startsWith("manual-");
    removeItem(item.id);
    showToast(
      `已移除「${item.name}」`,
      manual ? undefined : { label: "撤销", run: () => restoreRemoved(item.id) }
    );
  };

  const share = () => {
    const lines = pending.map((item) => `· ${item.name}${item.qty !== null ? ` ${item.qty}${item.unit}` : ""}`);
    Share.share({
      message: `${title}（${pending.length} 项）\n${lines.join("\n")}`,
      title,
    }).catch(() => {});
  };

  const renderRow = (item: ShoppingItem, index: number) => {
    const isFlipping = flipping.includes(item.id);
    return (
      <ShopRow
        key={item.id}
        item={item}
        checked={isFlipping ? !item.checked : item.checked}
        first={index === 0}
        editing={editingQty === item.id}
        qtyDraft={qtyDraft}
        onToggle={() => toggle(item)}
        onStartEdit={() => {
          if (item.qty === null) return;
          setQtyDraft(String(item.qty));
          setEditingQty(item.id);
        }}
        onDraft={setQtyDraft}
        onCommitDraft={() => commitDraft(item)}
        onStep={(dir) => step(item, dir)}
        onRemove={() => remove(item)}
      />
    );
  };

  const summaryText =
    total === 0 && carriedCount > 0
      ? `${carriedCount} 项已带到下周`
      : total === 0
        ? range
        : allBought
          ? "全部买齐了，开火吧"
          : `还差 ${pending.length} 样 · ${range}`;

  const showDetails = name.trim().length > 0 || nameFocused;

  return (
    <View style={styles.screen}>
      {/* 顶栏 */}
      <View style={[styles.topbar, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={6}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={IS_ANDROID ? "返回" : "关闭"}
        >
          {IS_ANDROID ? <ArrowBackIcon /> : <CloseIcon size={20} color={colors.ink} />}
        </Pressable>
        <AppText
          size={IS_ANDROID ? 20 : 17}
          weight={IS_ANDROID ? "700" : "800"}
          style={[styles.title, IS_ANDROID && styles.titleAndroid]}
          numberOfLines={1}
        >
          {title}
        </AppText>
        <Pressable
          onPress={share}
          disabled={pending.length === 0}
          hitSlop={6}
          style={({ pressed }) => [styles.iconBtn, pending.length === 0 && { opacity: 0.3 }, pressed && styles.iconBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="分享清单"
        >
          <ShareIcon />
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={spacing.xl}
        contentContainerStyle={{ paddingBottom: footerH + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 进度 + 菜篮 */}
        <Animated.View entering={FadeInDown.duration(motion.duration.slow)} style={styles.summary}>
          <View style={styles.summaryDeco} pointerEvents="none" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.countRow}>
              <Animated.View key={trippedCount} entering={reduced ? undefined : ZoomIn.springify().damping(12)}>
                <AppText size={40} weight="800" color={colors.white} style={styles.bigNum} maxFontSizeMultiplier={1}>
                  {trippedCount}
                </AppText>
              </Animated.View>
              <AppText size={18} weight="700" color={colors.onDeepSub} style={styles.num} maxFontSizeMultiplier={1}>
                /{total}
              </AppText>
            </View>
            <AppText size={13} color={colors.onDeepTitle} style={{ marginTop: 6 }} numberOfLines={2}>
              {summaryText}
            </AppText>
            {missingRecipeCount > 0 ? (
              <AppText size={11} color={colors.onDeepSub} style={{ marginTop: 4 }} numberOfLines={2}>
                另有 {missingRecipeCount} 道菜的食材未计入
              </AppText>
            ) : null}
          </View>
          <Basket progress={progress} bumpKey={bumpKey} />
        </Animated.View>

        {/* 手动添加 */}
        <Animated.View entering={FadeInDown.delay(60).duration(motion.duration.slow)} style={styles.addWrap}>
          <View style={styles.addRow}>
            <Animated.View style={[{ flex: 1 }, shakeStyle]}>
              <TextInput
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  if (addError) setAddError(null);
                }}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
                placeholder="加一样要买的"
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.field,
                  nameFocused && styles.fieldFocus,
                  addError ? styles.fieldError : null,
                ]}
                returnKeyType="done"
                onSubmitEditing={submit}
                accessibilityLabel="添加食材"
              />
            </Animated.View>
            <Pressable
              onPress={submit}
              style={({ pressed }) => [styles.addBtn, pressed && { transform: [{ scale: 0.94 }] }]}
              accessibilityRole="button"
              accessibilityLabel="添加到清单"
            >
              <PlusIcon size={20} color={colors.white} />
            </Pressable>
          </View>
          {addError ? (
            <Animated.View entering={FadeIn.duration(motion.duration.fast)}>
              <AppText size={12} weight="600" color={colors.accentText} style={styles.addErr}>
                {addError}
              </AppText>
            </Animated.View>
          ) : null}
          {showDetails ? (
            <Animated.View
              entering={FadeInDown.duration(motion.duration.base)}
              exiting={FadeOut.duration(motion.duration.fast)}
              style={styles.addDetails}
            >
              <TextInput
                value={qty}
                onChangeText={setQtyInput}
                placeholder="数量"
                keyboardType="decimal-pad"
                placeholderTextColor={colors.placeholder}
                style={[styles.field, styles.fieldSmall, { flex: 3 }]}
              />
              <TextInput
                value={unit}
                onChangeText={setUnit}
                placeholder="单位"
                placeholderTextColor={colors.placeholder}
                style={[styles.field, styles.fieldSmall, { flex: 2 }]}
              />
            </Animated.View>
          ) : null}
        </Animated.View>

        {/* 待买分组 */}
        {grouped.map((group, gi) => (
          <Animated.View
            key={group.category}
            entering={FadeInDown.delay(120 + gi * 60).duration(motion.duration.slow)}
            exiting={FadeOut.duration(motion.duration.base)}
            layout={LinearTransition.springify().damping(20).stiffness(160)}
            style={styles.group}
          >
            <View style={styles.groupHead}>
              <View style={[styles.groupDot, { backgroundColor: GROUP_COLOR[group.category] ?? colors.disabled }]} />
              <AppText size={15} weight="800" color={colors.muted}>
                {group.category} · {group.items.length}
              </AppText>
            </View>
            <View style={styles.list}>{group.items.map(renderRow)}</View>
          </Animated.View>
        ))}

        {/* 买齐 / 空 */}
        {pending.length === 0 ? (
          <Animated.View
            entering={reduced ? FadeIn : ZoomIn.springify().damping(12).stiffness(170)}
            style={styles.allset}
          >
            {total > 0 ? (
              <View style={styles.allsetArt}>
                <Basket progress={1} bumpKey={0} lineColor={colors.leaf} />
              </View>
            ) : null}
            <AppText size={20} weight="800" style={{ marginTop: spacing.sm, textAlign: "center" }}>
              {carriedCount > 0
                ? "这一周已经处理完"
                : total > 0
                  ? "全部买齐了，开火吧"
                  : "这一周还没有要买的"}
            </AppText>
            <AppText size={13} color={colors.muted} style={{ marginTop: 6, textAlign: "center" }}>
              {carriedCount > 0
                ? `${carriedCount} 项已带到下周`
                : total > 0
                  ? "勾掉的在下面「已购买」里"
                  : "排好菜，食材自动进清单"}
            </AppText>
          </Animated.View>
        ) : null}

        {/* 已移除 */}
        {removedItems.length > 0 ? (
          <View style={styles.fold}>
            <FoldHead
              open={showRemoved}
              label={`已移除 ${removedItems.length} 项`}
              a11y="已移除的食材，点开查看"
              onPress={() => setShowRemoved((value) => !value)}
            />
            {showRemoved ? (
              <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={[styles.list, styles.listFlat]}>
                {removedItems.map((item, index) => (
                  <View key={item.id} style={[styles.removedRow, index > 0 && styles.rowDivider]}>
                    <AppText size={15} color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>
                      {item.name}
                    </AppText>
                    <Pressable
                      onPress={() => restoreRemoved(item.id)}
                      hitSlop={8}
                      style={({ pressed }) => [styles.restoreBtn, pressed && { opacity: 0.7 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`恢复 ${item.name}`}
                    >
                      <AppText size={12} weight="700" color={colors.accentText}>恢复</AppText>
                    </Pressable>
                  </View>
                ))}
              </Animated.View>
            ) : null}
          </View>
        ) : null}

        {/* 已购买 */}
        {bought.length > 0 ? (
          <View style={styles.fold}>
            <View style={styles.foldRow}>
              <View style={{ flex: 1 }}>
                <FoldHead
                  open={showBought}
                  label={`已购买 ${bought.length} 样${showBought ? "" : "，点开查看"}`}
                  a11y="已购买，点开查看"
                  onPress={() => setShowBought((value) => !value)}
                />
              </View>
              <Pressable
                onPress={() => setResetOpen(true)}
                hitSlop={8}
                style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="撤销本周已买"
              >
                <AppText size={12} weight="600" color={colors.accentText}>撤销本周已买</AppText>
              </Pressable>
            </View>
            {showBought ? (
              <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={[styles.list, styles.listFlat]}>
                {bought.map(renderRow)}
              </Animated.View>
            ) : null}
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      {/* 底栏 */}
      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
        onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
      >
        {carriedCount > 0 ? (
          <Pressable
            style={styles.undoCarry}
            accessibilityRole="button"
            accessibilityLabel={`撤销顺延 ${carriedCount} 项`}
            onPress={() => {
              undoCarry();
              showToast("已撤销，这些食材回到待买");
            }}
          >
            <AppText size={12} color={colors.muted}>
              已把 {carriedCount} 项带到下周 ·{" "}
              <AppText size={12} weight="700" color={colors.accentText}>撤销</AppText>
            </AppText>
          </Pressable>
        ) : null}
        <View style={styles.footerRow}>
          {pending.length > 0 ? (
            <Pressable
              style={({ pressed }) => [styles.ghostBtn, pressed && { backgroundColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={`把未买的 ${pending.length} 项带到下周`}
              onPress={() => setCarryOpen(true)}
            >
              <AppText size={14} weight="700" color={colors.ink} numberOfLines={1}>
                没买的 {pending.length} 项带到下周
              </AppText>
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.doneBtn,
              allBought && { backgroundColor: colors.leafText },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            <AppText size={15} weight="700" color={colors.white} numberOfLines={1}>
              {pending.length > 0 ? "完成" : "完成"}
            </AppText>
          </Pressable>
        </View>
      </View>

      {/* 提示条 */}
      {toast ? (
        <Animated.View
          key={toast.id}
          entering={FadeInDown.springify().damping(18)}
          exiting={FadeOutDown.duration(motion.duration.fast)}
          style={[styles.toast, { bottom: footerH + spacing.md }]}
          accessibilityLiveRegion="polite"
        >
          <AppText size={13} weight="600" color={colors.white} style={{ flex: 1 }} numberOfLines={2}>
            {toast.text}
          </AppText>
          {toast.action ? (
            <Pressable
              onPress={() => {
                toast.action?.run();
                if (toastTimer.current) clearTimeout(toastTimer.current);
                setToastState(null);
              }}
              hitSlop={10}
              style={styles.toastAction}
              accessibilityRole="button"
              accessibilityLabel={toast.action.label}
            >
              <AppText size={13} weight="700" color={colors.sun}>{toast.action.label}</AppText>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}

      {resetOpen ? (
        <ConfirmDialog
          title="撤销本周已买？"
          message={`${bought.length} 项会回到待买。`}
          confirmLabel="撤销本周已买"
          destructive
          onCancel={() => setResetOpen(false)}
          onConfirm={() => {
            setResetOpen(false);
            resetChecked();
          }}
        />
      ) : null}

      {carryOpen ? (
        <ConfirmDialog
          title={`把未买的 ${pending.length} 项带到下周？`}
          message="同类食材会合并数量，不影响下周菜单。"
          confirmLabel="带到下周"
          onCancel={() => setCarryOpen(false)}
          onConfirm={() => {
            setCarryOpen(false);
            const result = carryPending();
            showToast(
              result.moved === 0
                ? "这周没有未买的食材"
                : `已带到下周：${result.moved} 项${result.merged > 0 ? `，其中 ${result.merged} 项已合并数量` : ""}`
            );
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },

  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    minHeight: 52,
  },
  iconBtn: {
    width: IS_ANDROID ? 48 : 44,
    height: IS_ANDROID ? 48 : 44,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnPressed: { backgroundColor: colors.surfaceAlt },
  title: { flex: 1, textAlign: "center" },
  titleAndroid: { textAlign: "left", paddingLeft: spacing.xs },

  summary: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xs,
    padding: 18,
    borderRadius: radius.xl,
    backgroundColor: colors.leafText,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    overflow: "hidden",
  },
  summaryDeco: {
    position: "absolute",
    right: -40,
    top: -50,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: colors.leaf,
    opacity: 0.35,
  },
  countRow: { flexDirection: "row", alignItems: "flex-end" },
  bigNum: { fontVariant: ["tabular-nums"], letterSpacing: -1.2, lineHeight: 44 },
  num: { fontVariant: ["tabular-nums"], marginBottom: 6, marginLeft: 2 },
  basket: { width: BASKET_W, height: BASKET_H },
  produce: { marginTop: 24 },
  basketClip: { position: "absolute", left: 0, right: 0, top: -24, height: 24 + 80, overflow: "hidden" },

  addWrap: { marginHorizontal: spacing.xl, marginTop: 18 },
  addRow: { flexDirection: "row", gap: spacing.sm },
  field: {
    height: 52,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    fontSize: 15,
    color: colors.ink,
    ...(IS_ANDROID
      ? {
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          borderBottomLeftRadius: 4,
          borderBottomRightRadius: 4,
          borderBottomWidth: 2,
          borderBottomColor: colors.placeholder,
        }
      : { borderRadius: 16, borderWidth: 1.5, borderColor: "transparent" }),
  },
  fieldSmall: { height: 46 },
  fieldFocus: IS_ANDROID ? { borderBottomColor: colors.accent } : { borderColor: colors.accent, backgroundColor: colors.surface },
  fieldError: IS_ANDROID ? { borderBottomColor: colors.danger } : { borderColor: colors.danger },
  addErr: { marginTop: 6, marginLeft: spacing.xs },
  addBtn: {
    width: 52,
    height: 52,
    borderRadius: BTN_RADIUS,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addDetails: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, marginRight: 52 + spacing.sm },

  group: { marginHorizontal: spacing.xl, marginTop: 22 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  groupDot: { width: 10, height: 10, borderRadius: 3 },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadow.card,
  },
  listFlat: { backgroundColor: colors.surfaceAlt, shadowOpacity: 0, elevation: 0 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    minHeight: 64,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, minWidth: 0 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  stepper: { flexDirection: "row", alignItems: "center" },
  stepBtn: { width: 28, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepBtnPressed: { backgroundColor: colors.surfaceAlt },
  qtyText: { minWidth: 44, textAlign: "center", fontVariant: ["tabular-nums"] },
  qtyInput: {
    width: 56,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "700",
    color: colors.accentText,
    paddingVertical: 2,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.accent,
  },
  trash: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },

  allset: { marginTop: 30, marginHorizontal: spacing.xl, alignItems: "center" },
  allsetArt: {
    width: 128,
    height: 112,
    borderRadius: 40,
    backgroundColor: colors.leafSoft,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 8,
  },

  fold: { marginHorizontal: spacing.xl, marginTop: 22 },
  foldRow: { flexDirection: "row", alignItems: "center" },
  foldHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48 },
  resetBtn: { paddingHorizontal: spacing.sm, minHeight: 40, justifyContent: "center" },
  removedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 52 },
  restoreBtn: {
    paddingHorizontal: spacing.md,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.canvas,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  undoCarry: { minHeight: 40, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  footerRow: { flexDirection: "row", gap: 10 },
  ghostBtn: {
    flex: 1.6,
    height: 52,
    borderRadius: BTN_RADIUS,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  doneBtn: {
    flex: 1,
    height: 52,
    borderRadius: BTN_RADIUS,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },

  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.primary,
    borderRadius: IS_ANDROID ? 6 : radius.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    ...shadow.floating,
  },
  toastAction: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
