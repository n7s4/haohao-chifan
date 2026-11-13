/**
 * 新建菜谱页的输入框、标签和小控件。
 *
 * 外观对齐设计稿的 `.field`：iOS 是灰底圆角块、聚焦描深色边；Android 走 Material 3 的
 * 「填充式输入框」——上圆下直、底部一条下划线，聚焦时下划线变番茄红。
 *
 * `typing` 是 AI 回填时的「打字机」效果：**只影响显示**，真正的值一开始就已经在表单 state 里，
 * 保存不会等它、也不会拿到半截字。用户一点进输入框就立刻停下、露出完整内容。
 */
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { AppText } from "../Common";
import { PlusIcon, SparkleIcon } from "../Icons";
import { colors, motion, radius } from "../../theme";
import { MinusIcon } from "./CreateIcons";

export const IS_ANDROID = Platform.OS === "android";

export type Typing = { run: number; delay: number };

/** 字段抖一下：校验失败时用，和设计稿的 `@keyframes shake` 同节奏。 */
function shakeTo(x: { set: (v: number) => void }) {
  x.set(
    withSequence(
      withTiming(-5, { duration: 50 }),
      withTiming(5, { duration: 80 }),
      withTiming(-5, { duration: 80 }),
      withTiming(5, { duration: 80 }),
      withTiming(0, { duration: 60 })
    )
  );
}

/**
 * 打字机：返回当前该显示的文字，以及「立刻打完」的开关。
 * `typing.run` 变一次就从头打一遍；节奏按长度自适应，长步骤也在 ~0.7 秒内打完。
 */
function useTypewriter(value: string, typing: Typing | null | undefined) {
  const [typedRun, setTypedRun] = useState(0);
  const [shown, setShown] = useState<number | null>(null);
  // 新的一轮回填：在渲染期就把显示长度归零，避免完整文字先闪一帧再被清空。
  if (typing && typing.run !== typedRun) {
    setTypedRun(typing.run);
    setShown(0);
  }
  const chars = Array.from(value);
  const total = chars.length;
  const active = shown !== null;
  const delay = typing?.delay ?? 0;

  useEffect(() => {
    if (!active) return;
    const tick = Math.max(16, Math.min(55, 720 / Math.max(total, 1)));
    let n = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        n += 1;
        if (n >= total) {
          if (timer) clearInterval(timer);
          setShown(null);
        } else {
          setShown(n);
        }
      }, tick);
    }, delay);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [active, typedRun, total, delay]);

  return {
    display: shown === null ? value : chars.slice(0, shown).join(""),
    typedRun,
    finish: () => setShown(null),
  };
}

export type FieldProps = Omit<TextInputProps, "style" | "value"> & {
  value: string;
  typing?: Typing | null;
  error?: boolean;
  /** 每次 +1 抖一下。 */
  shake?: number;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  inputRef?: (node: React.ComponentRef<typeof TextInput> | null) => void;
};

export function Field({
  value,
  typing,
  error,
  shake = 0,
  icon,
  style,
  inputStyle,
  inputRef,
  multiline,
  onFocus,
  onBlur,
  ...rest
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const { display, typedRun, finish } = useTypewriter(value, typing);
  const focusV = useSharedValue(0);
  const flash = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const delay = typing?.delay ?? 0;

  useEffect(() => {
    focusV.set(withTiming(focused ? 1 : 0, { duration: 200 }));
  }, [focused, focusV]);

  // 回填时整块底色先亮成阳光黄再褪回去，对应设计稿的 `.typed` flash。
  useEffect(() => {
    if (!typedRun) return;
    flash.set(0);
    flash.set(withDelay(delay, withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 1000 }))));
  }, [typedRun, delay, flash]);

  useEffect(() => {
    if (shake) shakeTo(shakeX);
  }, [shake, shakeX]);

  const animated = useAnimatedStyle(() => {
    // Android 的填充式输入框聚焦时底色不变，只换下划线颜色。
    const base = interpolateColor(focusV.value, [0, 1], [colors.surfaceAlt, IS_ANDROID ? colors.surfaceAlt : colors.surface]);
    return {
      backgroundColor: interpolateColor(flash.value, [0, 1], [base, colors.sunSoft]),
      transform: [{ translateX: shakeX.value }],
    };
  });

  const edge = error
    ? colors.danger
    : focused
      ? IS_ANDROID
        ? colors.accent
        : colors.ink
      : IS_ANDROID
        ? colors.placeholder
        : "transparent";

  return (
    <Animated.View
      style={[
        styles.field,
        IS_ANDROID ? [styles.fieldAndroid, { borderBottomColor: edge }] : { borderColor: edge },
        multiline && styles.fieldMultiline,
        animated,
        style,
      ]}
    >
      {icon ? <View style={multiline ? styles.iconTop : undefined}>{icon}</View> : null}
      <TextInput
        ref={inputRef}
        value={display}
        multiline={multiline}
        placeholderTextColor={colors.placeholder}
        onFocus={(event) => {
          setFocused(true);
          finish();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, multiline && styles.inputMultiline, inputStyle]}
        {...rest}
      />
    </Animated.View>
  );
}

/** 分组标题，设计稿 `.label`：圆体 14/700；可带一个「AI 提取」小标。 */
export function Label({
  children,
  hint,
  ai,
  style,
}: {
  children: React.ReactNode;
  hint?: string;
  ai?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.labelRow, style]}>
      <AppText size={14} weight="700">{children}</AppText>
      {hint ? <AppText size={12} color={colors.muted}>{hint}</AppText> : null}
      {ai ? <AiTag /> : null}
    </View>
  );
}

export function AiTag() {
  return (
    <View style={styles.aiTag}>
      <SparkleIcon size={10} color={colors.sunText} />
      <AppText size={10} weight="700" color={colors.sunText}>AI 提取</AppText>
    </View>
  );
}

/**
 * 「大概用时」步进器：± 5 分钟一档，中间也能直接输入。
 * 留空 = 不填（保存时记为没有用时），减到 5 以下就回到留空。
 */
export function MinutesStepper({
  value,
  onChange,
  flashRun = 0,
}: {
  value: string;
  onChange: (next: string) => void;
  flashRun?: number;
}) {
  const bump = useSharedValue(1);
  const flash = useSharedValue(0);

  useEffect(() => {
    if (!flashRun) return;
    flash.set(withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 1000 })));
    bump.set(withSequence(withTiming(1.18, { duration: 120 }), withSpring(1, motion.spring)));
  }, [flashRun, flash, bump]);

  const step = (delta: 5 | -5) => {
    const current = Number(value.trim());
    const base = value.trim() && Number.isFinite(current) ? current : 0;
    let next: number | null;
    if (!base) next = delta > 0 ? 15 : null;
    else {
      const snapped = delta > 0 ? Math.floor(base / 5) * 5 + 5 : Math.ceil(base / 5) * 5 - 5;
      next = snapped < 5 ? null : Math.min(snapped, 180);
    }
    const text = next === null ? "" : `${next}`;
    if (text === value) return;
    Haptics.selectionAsync().catch(() => {});
    bump.set(withSequence(withTiming(1.14, { duration: 90 }), withSpring(1, motion.spring)));
    onChange(text);
  };

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(flash.value, [0, 1], [colors.surfaceAlt, colors.sunSoft]),
  }));
  const num = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));

  return (
    <Animated.View style={[styles.stepper, box]}>
      <Pressable
        onPress={() => step(-5)}
        style={({ pressed }) => [styles.stepperBtn, pressed && styles.stepperBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel="少 5 分钟"
      >
        <MinusIcon size={18} color={value ? colors.ink : colors.disabled} />
      </Pressable>
      <Animated.View style={[styles.stepperValue, num]}>
        <TextInput
          value={value}
          onChangeText={(text) => onChange(text.replace(/[^\d.]/g, ""))}
          placeholder="—"
          placeholderTextColor={colors.placeholder}
          keyboardType="number-pad"
          style={styles.stepperInput}
          accessibilityLabel="大概用时，分钟"
          maxLength={4}
        />
        <AppText size={12} weight="600" color={colors.muted}>分钟</AppText>
      </Animated.View>
      <Pressable
        onPress={() => step(5)}
        style={({ pressed }) => [styles.stepperBtn, pressed && styles.stepperBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel="多 5 分钟"
      >
        <PlusIcon size={18} color={colors.ink} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  fieldAndroid: {
    borderWidth: 0,
    borderBottomWidth: 2,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  fieldMultiline: { alignItems: "flex-start" },
  iconTop: { marginTop: 15 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    fontSize: 15.5,
    color: colors.ink,
    paddingVertical: 0,
  },
  inputMultiline: {
    paddingTop: 14,
    paddingBottom: 14,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  aiTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 7,
    backgroundColor: colors.sunSoft,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    padding: 3,
    borderRadius: IS_ANDROID ? radius.pill : 14,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: IS_ANDROID ? 22 : 11,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnPressed: { backgroundColor: colors.surface },
  stepperValue: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", minWidth: 84, gap: 2 },
  stepperInput: {
    minWidth: 30,
    fontSize: 18,
    fontWeight: "800",
    color: colors.ink,
    textAlign: "center",
    paddingVertical: 0,
    fontVariant: ["tabular-nums"],
  },
});
