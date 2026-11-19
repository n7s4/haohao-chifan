import React, { useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { Easing, FadeIn, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { AppText, usePressScale } from "../Common";
import { defaultNickname, validateNickname } from "../../lib/community/logic";
import { colors, motion, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";

const backdropIn = FadeIn.duration(motion.duration.base);
const sheetIn = SlideInDown.duration(motion.duration.slow).easing(Easing.bezier(0.22, 1, 0.36, 1));

/**
 * 社区昵称底部弹层：首次互动时起名，或在账号页改名。
 * onConfirm 返回错误文案（失败）或 null（成功）；成功后由调用方卸载本组件。
 */
export function NicknameSheet({
  initial,
  title = "给自己起个名字",
  onConfirm,
  onCancel,
}: {
  initial?: string;
  title?: string;
  onConfirm: (nickname: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const press = usePressScale();
  const [value, setValue] = useState(() => initial ?? defaultNickname(Math.random));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  const submit = async () => {
    if (busy) return;
    const v = validateNickname(value);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onConfirm(v.value);
    if (message) {
      setBusy(false);
      setError(message);
    }
  };

  return (
    <Modal transparent animationType="none" visible onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Animated.View entering={backdropIn} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="取消" />
          <Animated.View
            entering={sheetIn}
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
            accessibilityViewIsModal
          >
            <View style={styles.grab} />
            <AppText size={21} weight="800" style={styles.title}>{title}</AppText>
            <AppText size={13} color={colors.muted} style={styles.hint}>
              其他人会在你的评论和菜谱上看到这个名字
            </AppText>
            <TextInput
              value={value}
              onChangeText={(text) => {
                setValue(text);
                if (error) setError(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="昵称"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={40}
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel="社区昵称"
              style={[
                styles.input,
                IS_ANDROID
                  ? { borderBottomColor: error ? colors.danger : focused ? colors.accent : colors.placeholder }
                  : {
                      borderColor: error ? colors.danger : focused ? colors.ink : "transparent",
                      backgroundColor: focused ? colors.surface : colors.surfaceAlt,
                    },
              ]}
            />
            {error ? (
              <Animated.View entering={FadeIn.duration(motion.duration.fast)}>
                <AppText size={13} color={colors.danger} style={styles.errorText}>{error}</AppText>
              </Animated.View>
            ) : null}
            <Pressable
              onPress={submit}
              onPressIn={press.onPressIn}
              onPressOut={press.onPressOut}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="就叫这个"
              accessibilityState={{ disabled: busy, busy }}
              style={styles.buttonHost}
            >
              <Animated.View style={[styles.button, busy && { opacity: 0.6 }, press.style]}>
                {busy ? <ActivityIndicator color={colors.white} size="small" /> : null}
                <AppText size={16} weight="700" color={colors.white}>就叫这个</AppText>
              </Animated.View>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(23,31,46,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    ...shadow.floating,
  },
  grab: {
    width: IS_ANDROID ? 32 : 36,
    height: IS_ANDROID ? 4 : 5,
    borderRadius: 3,
    backgroundColor: IS_ANDROID ? colors.placeholder : colors.border,
    alignSelf: "center",
    marginTop: IS_ANDROID ? 6 : 0,
    marginBottom: 14,
  },
  title: { letterSpacing: -0.3 },
  hint: { marginTop: 6, lineHeight: 19 },
  input: IS_ANDROID
    ? {
        marginTop: spacing.lg,
        minHeight: 52,
        paddingHorizontal: spacing.lg,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        borderBottomLeftRadius: 4,
        borderBottomRightRadius: 4,
        borderBottomWidth: 2,
        backgroundColor: colors.surfaceAlt,
        color: colors.ink,
        fontSize: 16,
      }
    : {
        marginTop: spacing.lg,
        minHeight: 52,
        paddingHorizontal: spacing.lg,
        borderRadius: 16,
        borderWidth: 1.5,
        color: colors.ink,
        fontSize: 16,
      },
  errorText: { marginTop: spacing.sm, lineHeight: 19 },
  buttonHost: { marginTop: spacing.lg },
  button: {
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    borderRadius: IS_ANDROID ? radius.pill : 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
});
