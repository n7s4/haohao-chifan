import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  PressableProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { AppText } from "../components/Common";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BackIcon, ChevronRightIcon, CloseIcon, SwapIcon } from "../components/Icons";
import { Toast, useToast } from "../components/Toast";
import {
  changePassword,
  displayNameFor,
  loadAvatar,
  replaceAvatar,
  type Avatar,
} from "../lib/account";
import { NicknameSheet } from "../components/community/NicknameSheet";
import { failMessage, useCommunityProfile } from "../lib/community/useCommunityProfile";
import { pickAvatarFromLibrary, takeAvatarPhoto } from "../lib/pickPhoto";
import { useAuth } from "../lib/useAuth";
import { colors, motion, radius, shadow, spacing } from "../theme";

const IS_ANDROID = Platform.OS === "android";
const PAD = 20;
const AVATAR = 104;

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)/profile");
};

/** 分段入场：每块晚 60ms 从下方浮上来（设计稿 .rise）。 */
const rise = (i: number) =>
  FadeInDown.delay(60 + i * 60).duration(motion.duration.slow).easing(Easing.out(Easing.cubic));

/** 底部抽屉从下面滑上来（设计稿 .sheet：.45s ease-out）。 */
const sheetIn = SlideInDown.duration(motion.duration.slow).easing(Easing.bezier(0.22, 1, 0.36, 1));

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { toast, show, undo } = useToast();
  const [avatar, setAvatar] = useState<Avatar>({ path: null, uri: null });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const community = useCommunityProfile();

  const name = displayNameFor(auth.email);
  const initial = name.slice(0, 1).toUpperCase();

  useEffect(() => {
    let active = true;
    if (!auth.userId) return;
    loadAvatar(auth.userId).then((next) => {
      if (active) setAvatar(next);
    });
    return () => {
      active = false;
    };
  }, [auth.userId]);

  const applyPick = async (pick: () => Promise<string | null>) => {
    if (!auth.userId) return;
    setPhotoSheet(false);
    try {
      const uri = await pick();
      if (!uri) return;
      setAvatarBusy(true);
      const next = await replaceAvatar(auth.userId, uri, avatar.path);
      setAvatar(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      show({ text: "头像已更新" });
    } catch (error) {
      show({ text: error instanceof Error ? error.message : "换头像失败，再试一次" });
    } finally {
      setAvatarBusy(false);
    }
  };

  const openNickname = async () => {
    // 还没有公开资料时走 ensure（起名即建档）；已有则直接改名。
    if (community.profile) {
      setNicknameOpen(true);
      return;
    }
    // 读取失败时先重试，不能把「读不到」当成「没起过名」。
    if (community.loadFailed) {
      const loaded = await community.reload();
      if (loaded === "error") {
        show({ text: "读取昵称失败，稍后再试" });
        return;
      }
      if (loaded) {
        setNicknameOpen(true);
        return;
      }
    }
    if (await community.ensure()) show({ text: "昵称已设置" });
  };

  const signOutAndSwitch = () => {
    setSignOutOpen(false);
    auth.signOut().then(() => {
      // 换账号走「退出 → 登录页」：本地图片缓存按 userId 分目录，不能原地切。
      router.replace("/sign-in");
    });
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
          <PressScale onPress={goBack} to={0.88} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="返回">
            <BackIcon color={colors.ink} />
          </PressScale>
          <AppText size={IS_ANDROID ? 20 : 17} weight="700" style={IS_ANDROID ? styles.titleAndroid : styles.titleIos}>
            账号与资料
          </AppText>
          {IS_ANDROID ? null : <View style={styles.iconSpacer} />}
        </View>

        <Animated.View entering={rise(0)} style={styles.avatarBlock}>
          <PressScale
            onPress={() => setPhotoSheet(true)}
            disabled={avatarBusy}
            to={0.93}
            accessibilityRole="button"
            accessibilityLabel="更换头像"
            hitSlop={10}
          >
            <Animated.View entering={ZoomIn.springify().damping(12).delay(80)}>
              <View style={styles.avatar}>
                {avatar.uri ? (
                  <Image source={{ uri: avatar.uri }} alt="头像" style={styles.avatarImage} resizeMode="cover" />
                ) : (
                  <AppText size={40} weight="800">{initial}</AppText>
                )}
                {avatarBusy ? (
                  <View style={styles.avatarBusy}>
                    <ActivityIndicator color={colors.white} />
                  </View>
                ) : null}
              </View>
            </Animated.View>
            <View style={styles.cameraBadge}>
              <CameraIcon size={16} color={colors.white} />
            </View>
          </PressScale>
          <AppText size={22} weight="800" style={styles.name} numberOfLines={1}>
            {name}
          </AppText>
          <AppText size={14} color={colors.muted} style={{ marginTop: 4 }} numberOfLines={1}>
            {auth.email ?? "未登录"}
          </AppText>
        </Animated.View>

        <Animated.View entering={rise(1)} style={[styles.group, { marginTop: spacing.xxl }]}>
          <Row
            icon={<CameraIcon size={19} color={colors.sunText} />}
            tint={colors.sunSoft}
            label="更换头像"
            onPress={() => setPhotoSheet(true)}
          />
          <Row
            icon={<UserIcon size={19} color={colors.accentText} />}
            tint={colors.accentSoft}
            label="社区昵称"
            sub={
              community.profile?.nickname ??
              (community.loadFailed ? "读取失败，点一下重试" : "还没起名，第一次评论或发布时再起")
            }
            onPress={openNickname}
          />
          <Row
            icon={<UserIcon size={19} color={colors.danger} />}
            tint={colors.accentSoft}
            label="黑名单"
            sub="你不会再看到 Ta 的内容，你们也无法互相关注"
            onPress={() => router.push("/blocked")}
          />
          <Row
            icon={<LockIcon size={19} color={colors.ink} />}
            tint={colors.skySoft}
            label="修改密码"
            sub="至少 6 位"
            onPress={() => setPasswordOpen(true)}
          />
          <Row
            icon={<SwapIcon size={19} color={colors.leafText} />}
            tint={colors.leafSoft}
            label="更换账号"
            onPress={() => setSignOutOpen(true)}
            last
          />
        </Animated.View>

        <Animated.View entering={rise(2)} style={[styles.group, { marginTop: spacing.md }]}>
          <Row
            icon={<LogoutIcon size={19} color={colors.danger} />}
            tint={colors.accentSoft}
            label="退出登录"
            danger
            onPress={() => setSignOutOpen(true)}
            last
          />
        </Animated.View>
      </ScrollView>

      <Toast toast={toast} bottom={insets.bottom + spacing.lg} onUndo={undo} />

      {photoSheet ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setPhotoSheet(false)}>
          <View style={styles.sheetBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPhotoSheet(false)} accessibilityLabel="取消" />
            <Animated.View entering={sheetIn} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
              <View style={styles.grab} />
              <AppText size={21} weight="800" style={styles.sheetTitle}>更换头像</AppText>
              <View style={{ height: spacing.lg }} />
              <SheetItem
                icon={<CameraIcon size={20} color={colors.accentText} />}
                tint={colors.accentSoft}
                label="拍照"
                onPress={() => applyPick(takeAvatarPhoto)}
              />
              <SheetItem
                icon={<PhotoIcon size={20} color={colors.leafText} />}
                tint={colors.leafSoft}
                label="从相册选择"
                onPress={() => applyPick(pickAvatarFromLibrary)}
              />
              <PressScale
                onPress={() => setPhotoSheet(false)}
                style={[styles.btn, styles.btnSoft, { marginTop: spacing.md }]}
                accessibilityRole="button"
                accessibilityLabel="取消"
              >
                <AppText size={16} weight="700">取消</AppText>
              </PressScale>
            </Animated.View>
          </View>
        </Modal>
      ) : null}

      {nicknameOpen && community.profile ? (
        <NicknameSheet
          title="修改社区昵称"
          initial={community.profile.nickname}
          onCancel={() => setNicknameOpen(false)}
          onConfirm={async (nickname) => {
            const result = await community.rename(nickname);
            if (!result.ok) return failMessage(result.reason);
            setNicknameOpen(false);
            show({ text: "昵称已更新" });
            return null;
          }}
        />
      ) : null}

      {passwordOpen ? (
        <PasswordSheet
          onClose={() => setPasswordOpen(false)}
          onDone={() => {
            setPasswordOpen(false);
            show({ text: "密码已更新" });
          }}
        />
      ) : null}

      {signOutOpen ? (
        <ConfirmDialog
          title="确定要退出登录吗？"
          message="本机数据会保留，重新登录即可继续同步。"
          confirmLabel="退出登录"
          destructive
          onCancel={() => setSignOutOpen(false)}
          onConfirm={signOutAndSwitch}
        />
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- 小部件 */

const APressable = Animated.createAnimatedComponent(Pressable);

/** 按下回弹（设计稿 :active scale + ease-spring）。 */
function PressScale({
  to = 0.96,
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  to?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <APressable
      {...rest}
      onPressIn={(event) => {
        scale.set(withSpring(to, motion.spring));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, motion.spring));
        onPressOut?.(event);
      }}
      style={[style, animated]}
    >
      {children}
    </APressable>
  );
}

function Row({
  icon,
  tint,
  label,
  sub,
  onPress,
  danger,
  last,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  sub?: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && { backgroundColor: colors.surfaceAlt }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <AppText size={15} weight="700" color={danger ? colors.danger : colors.ink}>{label}</AppText>
        {sub ? (
          <AppText size={12.5} color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>{sub}</AppText>
        ) : null}
      </View>
      {danger ? null : <ChevronRightIcon size={18} color={colors.placeholder} />}
    </Pressable>
  );
}

function SheetItem({
  icon,
  tint,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressScale onPress={onPress} style={styles.sheetItem} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>{icon}</View>
      <AppText size={16} weight="700" style={{ flex: 1 }}>{label}</AppText>
      <ChevronRightIcon size={18} color={colors.placeholder} />
    </PressScale>
  );
}

function PasswordSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const longEnough = password.length >= 6;
  const matches = password.length > 0 && password === confirm;
  const ready = longEnough && matches && !busy;
  const mismatch = confirm.length > 0 && confirm.length >= password.length && !matches;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const message = await changePassword(password);
    setBusy(false);
    if (message) {
      setError(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      shake.set(
        withSequence(
          withTiming(-5, { duration: 50 }),
          withTiming(5, { duration: 80 }),
          withTiming(-5, { duration: 80 }),
          withTiming(5, { duration: 80 }),
          withTiming(0, { duration: 50 })
        )
      );
    } else onDone();
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={[styles.sheetBackdrop, styles.sheetBackdropFlex]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
          <Animated.View entering={sheetIn} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.grab} />
            <View style={styles.sheetHeader}>
              <AppText size={21} weight="800" style={styles.sheetTitle}>修改密码</AppText>
              <PressScale
                onPress={onClose}
                to={0.88}
                hitSlop={6}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="关闭"
              >
                <CloseIcon color={colors.ink} />
              </PressScale>
            </View>
            <Animated.View style={shakeStyle}>
              <PasswordField
                label="新密码"
                value={password}
                onChange={setPassword}
                visible={visible}
                toggle={() => setVisible((current) => !current)}
                placeholder="至少 6 位"
                ok={longEnough}
              />
              <PasswordField
                label="确认新密码"
                value={confirm}
                onChange={setConfirm}
                visible={visible}
                toggle={() => setVisible((current) => !current)}
                placeholder="再输一次"
                ok={matches && longEnough}
                bad={mismatch}
              />
            </Animated.View>
            {mismatch ? (
              <AppText size={13} color={colors.danger} style={styles.hint}>两次输入的不一样</AppText>
            ) : null}
            {error ? (
              <Animated.View entering={FadeIn.duration(motion.duration.fast)}>
                <AppText size={13} color={colors.danger} style={styles.hint}>{error}</AppText>
              </Animated.View>
            ) : null}
            <AppText size={13} color={colors.muted} style={styles.hint}>
              其他设备需要重新登录
            </AppText>
            <PressScale
              onPress={save}
              disabled={!ready}
              style={[styles.btn, styles.btnPrimary, !ready && { opacity: 0.4 }, { marginTop: spacing.lg }]}
              accessibilityRole="button"
              accessibilityLabel="保存新密码"
              accessibilityState={{ disabled: !ready, busy }}
            >
              {busy ? <ActivityIndicator color={colors.white} size="small" /> : null}
              <AppText size={16} weight="700" color={colors.white}>
                {busy ? "保存中…" : "保存"}
              </AppText>
            </PressScale>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  toggle,
  placeholder,
  ok,
  bad,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  visible: boolean;
  toggle: () => void;
  placeholder: string;
  ok?: boolean;
  bad?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const focusStyle = IS_ANDROID
    ? { borderBottomColor: bad ? colors.danger : focused ? colors.accent : colors.placeholder }
    : {
        borderColor: bad ? colors.danger : focused ? colors.ink : "transparent",
        backgroundColor: focused ? colors.surface : colors.surfaceAlt,
      };
  return (
    <View style={{ marginTop: spacing.md }}>
      <AppText size={14} weight="700" style={{ marginBottom: spacing.sm }}>{label}</AppText>
      <View style={[IS_ANDROID ? styles.fieldAndroid : styles.field, focusStyle]}>
        <LockIcon size={18} color={colors.placeholder} />
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        {ok ? (
          <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.okDot}>
            <CheckMark />
          </Animated.View>
        ) : null}
        <Pressable onPress={toggle} hitSlop={10} accessibilityRole="button" accessibilityLabel={visible ? "隐藏密码" : "显示密码"}>
          <AppText size={13} weight="700" color={colors.muted}>{visible ? "隐藏" : "显示"}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------ 本页图标 */

type IconProps = { size?: number; color?: string };

function CameraIcon({ size = 18, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12.5} r={3.3} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

function PhotoIcon({ size = 18, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={4.5} width={17} height={15} rx={3} stroke={color} strokeWidth={2} />
      <Circle cx={9} cy={9.5} r={1.6} fill={color} />
      <Path d="m4.5 17 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
}

function UserIcon({ size = 18, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8.5} r={3.8} stroke={color} strokeWidth={2} />
      <Path d="M4.5 19.5c.8-3.4 3.8-5.2 7.5-5.2s6.7 1.8 7.5 5.2" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function LockIcon({ size = 18, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={5} y={10.5} width={14} height={10} rx={2.5} stroke={color} strokeWidth={2} />
      <Path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function LogoutIcon({ size = 19, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14 4.5h3.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H14M10 8 6 12l4 4M6 12h10"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CheckMark() {
  return (
    <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
      <Path d="m5 12.5 4.5 4.5L19 7.5" stroke={colors.white} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingBottom: 6,
    minHeight: 52,
  },
  iconBtn: {
    width: IS_ANDROID ? 48 : 44,
    height: IS_ANDROID ? 48 : 44,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  iconSpacer: { width: 44 },
  titleIos: { flex: 1, textAlign: "center" },
  titleAndroid: { flex: 1, paddingLeft: 4 },
  avatarBlock: { alignItems: "center", marginTop: spacing.lg, paddingHorizontal: PAD },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: 34,
    backgroundColor: colors.sun,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    transform: [{ rotate: "-5deg" }],
  },
  avatarImage: { width: AVATAR, height: AVATAR },
  avatarBusy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(23,31,46,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBadge: {
    position: "absolute",
    right: -6,
    bottom: -4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { marginTop: spacing.lg, letterSpacing: -0.4 },
  group: {
    marginHorizontal: PAD,
    borderRadius: IS_ANDROID ? 20 : radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
    ...shadow.card,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(23,31,46,0.4)",
    justifyContent: "flex-end",
  },
  // 键盘弹出时外层让出底部空间，这里改成撑满而不是绝对定位，背板才会跟着上移。
  sheetBackdropFlex: { position: "relative", flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: PAD,
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
  sheetTitle: { letterSpacing: -0.3 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 60,
    paddingHorizontal: 14,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  btn: {
    flexDirection: "row",
    minHeight: 52,
    borderRadius: IS_ANDROID ? radius.pill : 16,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: 22,
  },
  btnSoft: { backgroundColor: colors.surfaceAlt },
  btnPrimary: {
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "transparent",
    backgroundColor: colors.surfaceAlt,
  },
  fieldAndroid: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    borderBottomWidth: 2,
    backgroundColor: colors.surfaceAlt,
  },
  input: { flex: 1, color: colors.ink, fontSize: 15.5, paddingVertical: 0 },
  okDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.leaf,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { marginTop: spacing.md, lineHeight: 19 },
});
