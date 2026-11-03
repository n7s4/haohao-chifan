import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Card } from "../components/Common";
import { useAuth } from "../lib/useAuth";
import { useStore } from "../state/store";
import { colors, radius, shadow, spacing } from "../theme";

type Mode = "in" | "up";

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { syncPaused } = useStore();
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = emailOk && password.length >= 6;

  /**
   * 深链直接打开 /sign-in 时没有可回退的历史，`router.back()` 会抛
   * "The action 'GO_BACK' was not handled by any navigator"。
   */
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  };

  /**
   * 按钮不做 disabled：浏览器/系统的自动填充不会触发 onChangeText，
   * 一旦按「填空了才可点」来禁用，用户看到的是两个框都填好、按钮却点不动。
   * 所以按钮常亮，缺什么在点下去时直接说清楚。
   */
  const submit = async () => {
    if (busy) return;
    if (!emailOk) {
      setError("邮箱格式看起来不对，检查一下");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "in") {
        const message = await auth.signIn(email, password);
        if (message) setError(message);
        else leave();
      } else {
        const result = await auth.signUp(email, password);
        if (result.error) setError(result.error);
        else if (result.needsConfirm) {
          setNotice("注册成功，去邮箱点一下确认链接，回来再登录。");
          setMode("in");
        } else {
          leave();
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xxl,
          paddingBottom: insets.bottom + spacing.xxl,
          paddingHorizontal: spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <Pressable
            onPress={leave}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="返回"
          >
            <AppText size={15} color={colors.muted}>‹ 返回</AppText>
          </Pressable>
        </View>

        <AppText size={26} weight="800" style={{ marginTop: spacing.lg }}>
          {auth.userId ? "账号" : mode === "in" ? "登录好好吃饭" : "创建账号"}
        </AppText>
        <AppText size={12} color={colors.muted} style={{ marginTop: spacing.sm, lineHeight: 19 }}>
          {auth.userId
            ? "登录后菜单、收藏和采购清单会在你的账号里同步。"
            : "登录后，这台设备上的菜单会跟着账号走，换手机也不用重新排。"}
        </AppText>

        {auth.userId ? (
          <Card style={styles.card}>
            <AppText size={13} weight="600">{auth.email ?? "已登录"}</AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 4 }}>
              {syncPaused ? "同步暂停了，改动还留在本机，下面这条恢复后会自动补传" : "数据会在回到前台时自动同步"}
            </AppText>
            {syncPaused ? (
              <AppText size={10} color={colors.orangeText} style={{ marginTop: 6, lineHeight: 16 }}>
                {syncPaused}
              </AppText>
            ) : null}
            <Pressable
              onPress={() => auth.signOut()}
              style={[styles.button, { backgroundColor: colors.greenSoft, marginTop: spacing.lg }]}
              accessibilityRole="button"
              accessibilityLabel="退出登录"
            >
              <AppText size={13} weight="600" color={colors.green}>退出登录</AppText>
            </Pressable>
            <AppText size={10} color={colors.muted} style={styles.hint}>
              退出后这台设备上的数据仍保留，重新登录会继续同步。
            </AppText>
          </Card>
        ) : !auth.configured ? (
          <Card style={styles.card}>
            <AppText size={13} weight="600">云端还没配置</AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 4, lineHeight: 18 }}>
              当前是纯本地模式，所有数据只存在这台设备上。配置好 Supabase 后这里会出现登录入口。
            </AppText>
          </Card>
        ) : (
          <Card style={styles.card}>
            <View style={styles.tabs}>
              {(["in", "up"] as Mode[]).map((item) => (
                <Pressable
                  key={item}
                  onPress={() => {
                    setMode(item);
                    setError(null);
                    setNotice(null);
                  }}
                  style={[styles.tab, mode === item && styles.tabActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === item }}
                >
                  <AppText
                    size={12}
                    weight="600"
                    color={mode === item ? colors.cream : colors.muted}
                  >
                    {item === "in" ? "登录" : "注册"}
                  </AppText>
                </Pressable>
              ))}
            </View>

            <AppText size={11} weight="600" color={colors.muted} style={styles.label}>邮箱</AppText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#A5AB98"
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              editable={!busy}
            />

            <AppText size={11} weight="600" color={colors.muted} style={styles.label}>密码</AppText>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="至少 6 位"
              placeholderTextColor="#A5AB98"
              style={styles.input}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              textContentType={mode === "in" ? "password" : "newPassword"}
              editable={!busy}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {error ? (
              <AppText size={11} color={colors.orangeText} style={styles.message}>{error}</AppText>
            ) : null}
            {notice ? (
              <AppText size={11} color={colors.green} style={styles.message}>{notice}</AppText>
            ) : null}

            <Pressable
              onPress={submit}
              style={[styles.button, { backgroundColor: ready ? colors.orangeText : colors.green }]}
              accessibilityRole="button"
              accessibilityState={{ busy }}
              accessibilityLabel={mode === "in" ? "登录" : "注册"}
            >
              {busy ? (
                <ActivityIndicator color={colors.cream} />
              ) : (
                <AppText size={13} weight="700" color={colors.cream}>
                  {mode === "in" ? "登录" : "创建账号"}
                </AppText>
              )}
            </Pressable>

            <AppText size={10} color={colors.muted} style={styles.hint}>
              密码由 Supabase 保管，App 里不存明文。忘记密码暂不支持，需要重置请联系管理员。
            </AppText>
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  topBar: { flexDirection: "row", alignItems: "center" },
  card: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    marginTop: spacing.xxl,
    ...shadow.card,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.canvas,
    borderRadius: radius.pill,
    padding: 3,
    marginBottom: spacing.lg,
  },
  tab: { flex: 1, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: colors.green },
  label: { marginTop: spacing.md, marginBottom: 2 },
  input: {
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: "#F5F5EE",
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
    fontSize: 14,
    color: colors.ink,
  },
  button: {
    height: 46,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  message: { marginTop: spacing.md, lineHeight: 17 },
  hint: { marginTop: spacing.md, lineHeight: 16 },
});
