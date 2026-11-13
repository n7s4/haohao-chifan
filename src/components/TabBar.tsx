import type { BottomTabBarProps } from "expo-router/js-tabs";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { AppText } from "./Common";
import { CalendarIcon, CompassIcon, HeartIcon, PlusIcon, UserIcon } from "./Icons";
import { colors, motion } from "../theme";

/**
 * 主导航（对应设计稿 app.css「Tab bar」一节）
 * - iOS：5 栏，中间是墨蓝圆角方块「+」，微微歪 -6°，按下回正。
 * - Android：M3 导航栏 4 栏 + 选中胶囊；「新建」挪到右下角 FAB，只在发现 / 收藏出现。
 */

const IS_ANDROID = Platform.OS === "android";

/** 页面往下滚时把 FAB 收成只剩「+」。滚动页写 true / false，FAB 读。 */
export const fabCollapsed = makeMutable(false);

type TabMeta = { label: string; icon: (color: string, focused: boolean) => React.ReactNode };
const TABS: Record<string, TabMeta> = {
  index: { label: "发现", icon: (c, f) => <CompassIcon size={IS_ANDROID ? 24 : 25} color={c} filled={f} /> },
  plan: { label: "计划", icon: (c, f) => <CalendarIcon size={IS_ANDROID ? 24 : 25} color={c} filled={f} /> },
  favorites: { label: "收藏", icon: (c, f) => <HeartIcon size={IS_ANDROID ? 24 : 25} color={f ? colors.accent : c} filled={f} /> },
  profile: { label: "我的", icon: (c) => <UserIcon size={IS_ANDROID ? 24 : 25} color={c} /> },
};

const openCreate = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  router.push("/create-recipe");
};

export function TabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {

  const items = state.routes.map((route, index) => {
    if (route.name === "create") {
      return IS_ANDROID ? null : <CreateSlot key={route.key} />;
    }
    const meta = TABS[route.name];
    if (!meta) return null;
    const focused = state.index === index;
    const onPress = () => {
      const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        Haptics.selectionAsync().catch(() => {});
        navigateToTab(route.key);
      }
    };
    return <TabItem key={route.key} meta={meta} focused={focused} onPress={onPress} />;
  });

  return (
    <View
        style={[
          IS_ANDROID ? styles.barAndroid : styles.barIos,
          { paddingBottom: insets.bottom + (IS_ANDROID ? 12 : 4) },
        ]}
        accessibilityRole="tablist"
      >
        {items}
    </View>
  );
}

function TabItem({ meta, focused, onPress }: { meta: TabMeta; focused: boolean; onPress: () => void }) {
  const bump = useSharedValue(1);
  const pill = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    pill.set(withTiming(focused ? 1 : 0, { duration: motion.duration.base }));
    // 刚被选中时图标「弹」一下：先缩再用弹簧回来。
    if (focused) bump.set(withSequence(withTiming(0.82, { duration: 90 }), withSpring(1, motion.spring)));
  }, [focused, bump, pill]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  const pillStyle = useAnimatedStyle(() => ({
    opacity: pill.value,
    transform: [{ scaleX: 0.4 + pill.value * 0.6 }],
  }));

  const color = focused ? colors.ink : IS_ANDROID ? colors.muted : colors.placeholder;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        bump.set(withTiming(0.86, { duration: 90 }));
      }}
      onPressOut={() => {
        bump.set(withSpring(1, motion.spring));
      }}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.label}
    >
      <View style={IS_ANDROID ? styles.pillSlot : styles.iconSlot}>
        {IS_ANDROID ? <Animated.View style={[styles.pill, pillStyle]} /> : null}
        <Animated.View style={iconStyle}>{meta.icon(color, focused)}</Animated.View>
      </View>
      <AppText size={IS_ANDROID ? 12 : 10.5} weight={focused ? "700" : "600"} color={color}>
        {meta.label}
      </AppText>
    </Pressable>
  );
}

/** iOS 中间的新建按钮：不切 tab，直接推开录菜页。 */
function CreateSlot() {
  const press = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-6 + press.value * 6}deg` }, { scale: 1 - press.value * 0.1 }],
  }));
  return (
    <Pressable
      onPress={openCreate}
      onPressIn={() => {
        press.set(withTiming(1, { duration: 120 }));
      }}
      onPressOut={() => {
        press.set(withSpring(0, motion.spring));
      }}
      style={styles.tab}
      accessibilityRole="button"
      accessibilityLabel="新建菜谱"
    >
      <Animated.View style={[styles.createBadge, style]}>
        <PlusIcon size={26} color={colors.white} />
      </Animated.View>
    </Pressable>
  );
}

/**
 * Android 扩展 FAB：默认带「新建菜谱」，滚动后收成方块。
 * 由发现 / 收藏页自己渲染在页面右下角（不能挂在 tab bar 里：Android 上超出父视图的部分点不到）。
 * iOS 返回 null，那边新建入口在 tab bar 中间。
 */
export function CreateFab({ bottom = 16 }: { bottom?: number }) {
  if (!IS_ANDROID) return null;
  return <Fab bottom={bottom} />;
}

function Fab({ bottom }: { bottom: number }) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.set(withSpring(1, motion.spring));
  }, [enter]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.6 + enter.value * 0.4 }],
  }));
  const labelStyle = useAnimatedStyle(() => {
    const open = fabCollapsed.value ? 0 : 1;
    return {
      maxWidth: withTiming(open * 96, { duration: motion.duration.base }),
      opacity: withTiming(open, { duration: motion.duration.fast }),
      marginLeft: withTiming(open * 10, { duration: motion.duration.base }),
    };
  });

  return (
    <Animated.View style={[styles.fabWrap, { bottom }, wrapStyle]}>
      <Pressable
        onPress={openCreate}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.88 }]}
        android_ripple={{ color: "rgba(255,255,255,0.18)" }}
        accessibilityRole="button"
        accessibilityLabel="新建菜谱"
      >
        <PlusIcon size={24} color={colors.white} />
        <Animated.View style={[{ overflow: "hidden" }, labelStyle]}>
          <AppText size={15} weight="700" color={colors.white} numberOfLines={1}>
            新建菜谱
          </AppText>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  barIos: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 8,
    paddingHorizontal: 6,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  barAndroid: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 12,
    paddingHorizontal: 8,
    backgroundColor: colors.surfaceAlt,
  },
  tab: { flex: 1, alignItems: "center", gap: IS_ANDROID ? 4 : 3, minHeight: 48 },
  iconSlot: { height: 27, alignItems: "center", justifyContent: "center" },
  pillSlot: { width: 64, height: 32, alignItems: "center", justifyContent: "center" },
  pill: { ...StyleSheet.absoluteFill, borderRadius: 16, backgroundColor: colors.accentSoft },
  createBadge: {
    width: 52,
    height: 52,
    marginTop: -4,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.ink,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  fabWrap: { position: "absolute", right: 16, zIndex: 41 },
  fab: {
    height: 56,
    minWidth: 56,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.ink,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    elevation: 6,
    shadowColor: colors.ink,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
});
