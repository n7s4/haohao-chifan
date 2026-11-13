/**
 * 新建菜谱页的分段控件和按压回弹按钮。
 * 分段控件对应设计稿 `.seg`：iOS 灰底 + 白色滑块；Android 走 M3 的描边胶囊 + 叶子绿浅底滑块。
 */
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { AppText } from "../Common";
import { colors, motion, radius } from "../../theme";
import { IS_ANDROID } from "./Field";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** 按下缩到 0.96、松手弹回：设计稿 `.btn:active`。 */
export function PressScale({
  style,
  children,
  scaleTo = 0.96,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  scaleTo?: number;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        scale.set(withTiming(scaleTo, { duration: 90 }));
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, motion.spring));
        rest.onPressOut?.(event);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  disabled?: boolean;
}) {
  const pad = IS_ANDROID ? 0 : 4;
  const [width, setWidth] = useState(0);
  const thumbW = width ? (width - pad * 2) / options.length : 0;
  const index = Math.max(0, options.findIndex((option) => option.key === value));
  const x = useSharedValue(0);
  // 第一次量到宽度时直接就位，之后切换才走弹簧。
  const ready = useSharedValue(0);

  useEffect(() => {
    if (!thumbW) return;
    const to = index * thumbW;
    x.set(ready.get() ? withSpring(to, motion.spring) : to);
    ready.set(1);
  }, [index, thumbW, x, ready]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      style={[styles.seg, IS_ANDROID && styles.segAndroid, disabled && { opacity: 0.5 }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {thumbW ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.thumb, IS_ANDROID && styles.thumbAndroid, { width: thumbW, top: pad, bottom: pad, left: pad }, thumb]}
        />
      ) : null}
      {options.map((option) => {
        const on = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => {
              if (disabled || on) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(option.key);
            }}
            style={styles.segBtn}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled }}
          >
            <AppText size={14} weight="700" color={on ? (IS_ANDROID ? colors.leafText : colors.ink) : colors.muted}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seg: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
  },
  segAndroid: {
    padding: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.placeholder,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  segBtn: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center" },
  thumb: {
    position: "absolute",
    borderRadius: 10,
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  thumbAndroid: {
    borderRadius: radius.pill,
    backgroundColor: colors.leafSoft,
    shadowOpacity: 0,
    elevation: 0,
  },
});
