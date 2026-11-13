import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
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
import Svg, { Path, Rect } from "react-native-svg";

import { AppText, Card, usePressScale } from "../components/Common";
import { FoodArt } from "../components/FoodArt";
import { BackIcon, CheckIcon } from "../components/Icons";
import { ArtKind } from "../data/recipes";
import { useAuth } from "../lib/useAuth";
import { useStore } from "../state/store";
import { colors, motion, radius, shadow, spacing } from "../theme";

type Mode = "in" | "up";

const rise = (i: number) =>
  FadeInDown.delay(i * 60 + 60).duration(motion.duration.slow).easing(Easing.out(Easing.cubic));

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { syncPaused } = useStore();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shake = useSharedValue(0);

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

  /** 校验没过：表单左右抖两下（设计稿 shake），减少动态效果时只给震动反馈。 */
  const fail = (message: string) => {
    setError(message);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    if (reduced) return;
    shake.set(
      withSequence(
        withTiming(-6, { duration: 60 }),
        withTiming(6, { duration: 80 }),
        withTiming(-4, { duration: 70 }),
        withTiming(0, { duration: 60 })
      )
    );
  };

  /**
   * 按钮不做 disabled：浏览器/系统的自动填充不会触发 onChangeText，
   * 一旦按「填空了才可点」来禁用，用户看到的是两个框都填好、按钮却点不动。
   * 所以按钮常亮，缺什么在点下去时直接说清楚。
   */
  const submit = async () => {
    if (busy) return;
    if (!emailOk) {
      fail(email.trim() ? "邮箱格式看起来不对，检查一下" : "先填一个邮箱");
      return;
    }
    if (password.length < 6) {
      fail("密码至少 6 位");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "in") {
        const message = await auth.signIn(email, password);
        if (message) fail(message);
        else leave();
      } else {
        const result = await auth.signUp(email, password);
        if (result.error) fail(result.error);
        else if (result.needsConfirm) {
          setNotice("注册成功，去邮箱点一下确认链接，回来再登录。");
          setMode("in");
        } else {
          leave();
        }
      }
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "网络异常，稍后再试");
    } finally {
      setBusy(false);
    }
  };

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <BackButton onPress={leave} />
        </View>

        <Scene />

        <Animated.View entering={rise(0)} style={styles.intro}>
          {auth.userId ? (
            <AppText size={34} weight="800" style={styles.logo}>
              我的<AppText size={34} weight="800" color={colors.accentText}>账号</AppText>
            </AppText>
          ) : (
            <AppText size={34} weight="800" style={styles.logo}>
              好好<AppText size={34} weight="800" color={colors.accentText}>吃饭</AppText>
            </AppText>
          )}
          <AppText size={15} color={colors.muted} style={styles.introText}>
            {auth.userId
              ? "登录后菜单、收藏和采购清单会在你的账号里同步。"
              : "登录后，菜单、收藏和采购清单在每台设备上同步，换手机也不用重新排。"}
          </AppText>
        </Animated.View>

        {auth.userId ? (
          <Animated.View entering={rise(1)} style={styles.body}>
            <Card style={styles.card}>
              <View style={styles.accountRow}>
                <Animated.View entering={reduced ? undefined : FadeIn.delay(200)} style={styles.okmark}>
                  <CheckIcon color={colors.white} size={20} />
                </Animated.View>
                <View style={{ flex: 1 }}>
                  <AppText size={16} weight="700" numberOfLines={1}>{auth.email ?? "已登录"}</AppText>
                  <AppText size={13} color={colors.muted} style={{ marginTop: 2, lineHeight: 18 }}>
                    {syncPaused ? "同步暂停了，改动还留在本机，下面这条恢复后会自动补传" : "数据会在回到前台时自动同步"}
                  </AppText>
                </View>
              </View>
              {syncPaused ? (
                <View style={styles.pausedBox}>
                  <AppText size={12} color={colors.danger} style={{ lineHeight: 17 }}>
                    {syncPaused}
                  </AppText>
                </View>
              ) : null}
              <BigButton
                label="退出登录"
                tone="soft"
                onPress={() => auth.signOut()}
                style={{ marginTop: spacing.lg }}
              />
              <AppText size={12} color={colors.muted} style={styles.hint}>
                退出后这台设备上的数据仍保留，重新登录会继续同步。
              </AppText>
            </Card>
          </Animated.View>
        ) : !auth.configured ? (
          <Animated.View entering={rise(1)} style={styles.body}>
            <Card style={styles.card}>
              <View style={styles.offlineBadge}>
                <AppText size={12} weight="700" color={colors.sunText}>纯本地模式</AppText>
              </View>
              <AppText size={16} weight="700" style={{ marginTop: spacing.md }}>云端还没配置</AppText>
              <AppText size={13} color={colors.muted} style={{ marginTop: 4, lineHeight: 19 }}>
                当前是纯本地模式，所有数据只存在这台设备上。配置好 Supabase 后这里会出现登录入口。
              </AppText>
            </Card>
          </Animated.View>
        ) : (
          <Animated.View entering={rise(1)} style={styles.body}>
            <Segmented
              mode={mode}
              onChange={(item) => {
                setMode(item);
                setError(null);
                setNotice(null);
              }}
            />

            <Animated.View style={shakeStyle}>
              <AppText size={14} weight="700" style={styles.label}>邮箱</AppText>
              <Field
                icon={<MailIcon />}
                invalid={Boolean(error) && !emailOk}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!busy}
                returnKeyType="next"
              />

              <AppText size={14} weight="700" style={styles.label}>密码</AppText>
              <Field
                icon={<LockIcon />}
                invalid={Boolean(error) && emailOk && password.length < 6}
                value={password}
                onChangeText={setPassword}
                placeholder="至少 6 位"
                secureTextEntry
                autoCapitalize="none"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                textContentType={mode === "in" ? "password" : "newPassword"}
                editable={!busy}
                onSubmitEditing={submit}
                returnKeyType="go"
              />
            </Animated.View>

            {error ? (
              <Animated.View key={error} entering={FadeIn.duration(motion.duration.fast)}>
                <AppText size={13} color={colors.danger} style={styles.message}>{error}</AppText>
              </Animated.View>
            ) : null}
            {notice ? (
              <Animated.View entering={FadeInDown.duration(motion.duration.base)} style={styles.notice}>
                <View style={styles.noticeDot}>
                  <CheckIcon color={colors.white} size={11} />
                </View>
                <AppText size={13} weight="600" color={colors.leafText} style={{ flex: 1, lineHeight: 19 }}>
                  {notice}
                </AppText>
              </Animated.View>
            ) : null}

            <BigButton
              label={mode === "in" ? "登录" : "创建账号"}
              a11yLabel={mode === "in" ? "登录" : "注册"}
              tone={ready ? "primary" : "dark"}
              busy={busy}
              onPress={submit}
              style={{ marginTop: spacing.xl }}
            />

            <AppText size={12} color={colors.muted} style={styles.hint}>
              密码由 Supabase 保管，App 里不存明文。忘记密码暂不支持，需要重置请联系管理员。
            </AppText>
          </Animated.View>
        )}

        {!auth.userId ? (
          <Pressable
            onPress={leave}
            style={({ pressed }) => [styles.guest, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="先随便看看"
          >
            <AppText size={14} weight="600" color={colors.muted}>先随便看看</AppText>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------- 顶部插画：四只碗上下轻轻浮动 ---------- */

const BOWLS: { kind: ArtKind; size: number; x: number; top: number; rotate: number; delay: number }[] = [
  // x 是相对屏宽的中心位置（0~1），和设计稿 left / right 的摆位对齐。
  { kind: "pasta", size: 150, x: 0.5, top: 50, rotate: -4, delay: 0 },
  { kind: "soup", size: 104, x: 0.2, top: 120, rotate: 8, delay: 1200 },
  { kind: "salad", size: 112, x: 0.79, top: 22, rotate: -10, delay: 600 },
  { kind: "toast", size: 70, x: 0.77, top: 190, rotate: 6, delay: 1800 },
];

function Scene() {
  const { width } = useWindowDimensions();
  const w = Math.min(width, 480);
  return (
    <View style={[styles.scene, { width: w }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {BOWLS.map((bowl, index) => (
        <FloatingBowl key={bowl.kind} {...bowl} left={bowl.x * w - bowl.size / 2} order={index} />
      ))}
    </View>
  );
}

function FloatingBowl({
  kind,
  size,
  left,
  top,
  rotate,
  delay,
  order,
}: {
  kind: ArtKind;
  size: number;
  left: number;
  top: number;
  rotate: number;
  delay: number;
  order: number;
}) {
  const reduced = useReducedMotion();
  const bob = useSharedValue(0);
  const pop = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      pop.set(1);
      bob.set(0);
      return;
    }
    pop.set(withDelay(order * 90, withSpring(1, motion.spring)));
    bob.set(
      withDelay(
        delay,
        withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true)
      )
    );
  }, [reduced, delay, order, bob, pop]);

  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.get() * 1.4),
    transform: [
      { translateY: -10 * bob.get() },
      { rotate: `${rotate}deg` },
      { scale: 0.6 + 0.4 * pop.get() },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.bowl,
        { width: size, height: size, borderRadius: size / 2, left, top, zIndex: order === 0 ? 2 : 1 },
        style,
      ]}
    >
      <FoodArt kind={kind} size={size} />
    </Animated.View>
  );
}

/* ---------- 小部件 ---------- */

function BackButton({ onPress }: { onPress: () => void }) {
  const press = usePressScale(0.88);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="返回"
    >
      <Animated.View style={[styles.iconBtn, press.style]}>
        <BackIcon color={colors.ink} size={22} />
      </Animated.View>
    </Pressable>
  );
}

function Segmented({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const pos = useSharedValue(mode === "up" ? 1 : 0);

  // 注册成功后代码里会把 mode 切回「登录」，滑块跟着走，所以监听 mode 而不是点按。
  useEffect(() => {
    const target = mode === "up" ? 1 : 0;
    pos.set(reduced ? withTiming(target, { duration: 0 }) : withSpring(target, motion.spring));
  }, [mode, reduced, pos]);

  const half = (width - 8) / 2;
  const thumbStyle = useAnimatedStyle(() => ({
    width: half,
    transform: [{ translateX: pos.get() * half }],
  }));

  return (
    <View style={styles.seg} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? <Animated.View style={[styles.segThumb, thumbStyle]} /> : null}
      {(["in", "up"] as Mode[]).map((item) => {
        const on = mode === item;
        return (
          <Pressable
            key={item}
            onPress={() => {
              if (!on) Haptics.selectionAsync().catch(() => {});
              onChange(item);
            }}
            style={styles.segItem}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <AppText size={14} weight="700" color={on ? colors.ink : colors.muted}>
              {item === "in" ? "登录" : "注册"}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function Field({ icon, invalid, ...input }: TextInputProps & { icon: React.ReactNode; invalid?: boolean }) {
  const [focused, setFocused] = useState(false);
  const android = Platform.OS === "android";
  return (
    <View
      style={[
        styles.field,
        android && styles.fieldAndroid,
        focused && (android ? styles.fieldAndroidFocused : styles.fieldFocused),
        invalid && (android ? { borderBottomColor: colors.danger } : { borderColor: colors.danger }),
      ]}
    >
      {icon}
      <TextInput
        {...input}
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        onFocus={(event) => {
          setFocused(true);
          input.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          input.onBlur?.(event);
        }}
      />
    </View>
  );
}

function BigButton({
  label,
  a11yLabel,
  tone,
  busy = false,
  onPress,
  style,
}: {
  label: string;
  a11yLabel?: string;
  tone: "primary" | "dark" | "soft";
  busy?: boolean;
  onPress: () => void;
  style?: object;
}) {
  const press = usePressScale();
  const fg = tone === "soft" ? colors.ink : colors.white;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={style}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      accessibilityLabel={a11yLabel ?? label}
    >
      <Animated.View
        style={[
          styles.button,
          tone === "primary" && styles.buttonPrimary,
          tone === "dark" && { backgroundColor: colors.ink },
          tone === "soft" && { backgroundColor: colors.surfaceAlt },
          press.style,
        ]}
      >
        {busy ? <ActivityIndicator color={fg} /> : <AppText size={16} weight="700" color={fg}>{label}</AppText>}
      </Animated.View>
    </Pressable>
  );
}

function MailIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={5.5} width={17} height={13} rx={3} stroke={colors.placeholder} strokeWidth={2} />
      <Path d="m4.5 7.5 7.5 5.5 7.5-5.5" stroke={colors.placeholder} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function LockIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Rect x={4.5} y={10.5} width={15} height={10} rx={3} stroke={colors.placeholder} strokeWidth={2} />
      <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={colors.placeholder} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, zIndex: 5 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  scene: { height: 290, marginTop: -36, alignSelf: "center" },
  bowl: {
    position: "absolute",
    backgroundColor: colors.surface,
    ...shadow.floating,
  },
  intro: { paddingHorizontal: 24 },
  logo: { lineHeight: 40, letterSpacing: -1 },
  introText: { marginTop: 6, lineHeight: 22 },
  body: { paddingHorizontal: 24, paddingTop: 22 },
  card: { padding: spacing.xl },
  accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  okmark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.leaf,
    alignItems: "center",
    justifyContent: "center",
  },
  pausedBox: {
    marginTop: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  offlineBadge: {
    alignSelf: "flex-start",
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: colors.sunSoft,
    justifyContent: "center",
  },
  seg: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    padding: 4,
    marginBottom: spacing.xs,
  },
  segThumb: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 10,
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segItem: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center" },
  label: { marginTop: spacing.lg, marginBottom: spacing.sm },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  fieldFocused: { borderColor: colors.ink, backgroundColor: colors.surface },
  fieldAndroid: {
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomColor: colors.placeholder,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  fieldAndroidFocused: { borderBottomColor: colors.accent },
  input: { flex: 1, minHeight: 50, fontSize: 15.5, color: colors.ink, paddingVertical: 0 },
  button: {
    minHeight: 52,
    borderRadius: Platform.OS === "android" ? radius.pill : 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  message: { marginTop: spacing.md, lineHeight: 18 },
  notice: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.leafSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  noticeDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginTop: 1,
    backgroundColor: colors.leaf,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { marginTop: spacing.md, lineHeight: 17 },
  guest: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.lg, marginTop: spacing.md },
});
