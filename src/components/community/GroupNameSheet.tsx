import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { Easing, FadeIn, SlideInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { GROUP_NAME_MAX, validateGroupName } from "../../lib/community/messagesLogic";
import { colors, motion, shadow, spacing } from "../../theme";
import { AppText, usePressScale } from "../Common";

const backdropIn = FadeIn.duration(motion.duration.base);
const sheetIn = SlideInDown.duration(motion.duration.slow).easing(Easing.bezier(0.22, 1, 0.36, 1));

/** 改群名底部弹层。onConfirm 返回错误文案（失败）或 null（成功）；成功后由调用方卸载。 */
export function GroupNameSheet({
  initial,
  onConfirm,
  onCancel,
}: {
  initial: string;
  onConfirm: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const press = usePressScale();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  const submit = async () => {
    if (busy) return;
    const name = validateGroupName(value);
    if (!name) {
      setError("群名要 1–30 个字");
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onConfirm(name);
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
          <Animated.View entering={sheetIn} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]} accessibilityViewIsModal>
            <View style={styles.grab} />
            <AppText size={21} weight="800" style={styles.title}>修改群名</AppText>
            <TextInput
              value={value}
              onChangeText={(text) => {
                setValue(text);
                if (error) setError(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="群名"
              placeholderTextColor={colors.placeholder}
              autoCorrect={false}
              maxLength={GROUP_NAME_MAX}
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel="群名"
              style={[
                styles.input,
                {
                  borderColor: error ? colors.danger : focused ? colors.ink : "transparent",
                  backgroundColor: focused ? colors.surface : colors.surfaceAlt,
                },
              ]}
            />
            {error ? <AppText size={13} color={colors.danger} style={styles.errorText}>{error}</AppText> : null}
            <Pressable
              onPress={submit}
              onPressIn={press.onPressIn}
              onPressOut={press.onPressOut}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="保存群名"
              accessibilityState={{ disabled: busy, busy }}
            >
              <Animated.View style={[styles.button, busy && { opacity: 0.6 }, press.style]}>
                {busy ? <ActivityIndicator color={colors.white} size="small" /> : null}
                <AppText size={16} weight="700" color={colors.white}>保存</AppText>
              </Animated.View>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(23,31,46,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    ...shadow.floating,
  },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center" },
  title: { marginTop: spacing.md },
  input: {
    marginTop: spacing.lg,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.ink,
  },
  errorText: { marginTop: spacing.sm },
  button: {
    marginTop: spacing.lg,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.ink,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
