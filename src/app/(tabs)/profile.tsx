import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  Image,
  Platform,
  Pressable,
  PressableProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { BackupSheet } from "../../components/BackupSheet";
import { AppText } from "../../components/Common";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ChevronRightIcon, PlusIcon, UserIcon } from "../../components/Icons";
import { RecipeTile } from "../../components/RecipeTile";
import { Toast, useToast } from "../../components/Toast";
import { displayNameFor, loadAvatar } from "../../lib/account";
import {
  NotifyPermission,
  openNotificationSettings,
  readNotifyPermission,
  requestNotifyPermission,
} from "../../lib/cookNotify";
import { useRecipeCoverUris } from "../../lib/useMedia";
import { useAuth } from "../../lib/useAuth";
import { addDays, parseKey, startOfWeek, toKey, useStore } from "../../state/store";
import { colors, motion, radius, shadow, spacing } from "../../theme";

const IS_ANDROID = Platform.OS === "android";
const PAD = 20;
const TILE_W = 140;
const TILE_ART = 120;
const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const APP_VERSION = "1.0.0";
/** 灶台火苗：插画专用的两层暖色（外焰橙 / 内焰黄）。 */
const FLAME_OUTER = "#FF9A2E";

/** 「12 分钟 · 3 步」：老数据 minutes 是 0 时不要显示「0 分钟」。 */
const recipeMeta = (minutes: number, steps: number) => {
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} 分钟`);
  if (steps > 0) parts.push(`${steps} 步`);
  return parts.join(" · ") || "还没有步骤";
};

/** 横排卡片的副标题用短日期「10/26」，不带星期。 */
const shortDate = (key: string) => {
  const date = parseKey(key);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

/** 分段入场：每块晚 60ms 从下方浮上来（设计稿 .rise）。 */
const rise = (i: number) =>
  FadeInDown.delay(60 + i * 60).duration(motion.duration.slow).easing(Easing.out(Easing.cubic));

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const {
    favorites,
    plan,
    weekDays,
    cookedLog,
    guestLocalOnly,
    syncPaused,
    lastSyncedAt,
    pendingCount,
    syncNow,
    syncing,
    reopenGuestMerge,
    findRecipe,
    customRecipes,
    shoppingItems,
    lastExportAt,
  } = useStore();
  const { toast, show, undo } = useToast();
  const [backupOpen, setBackupOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const auth = useAuth();

  /** 相对时间要在渲染之外取，用一分钟一跳的 tick 驱动，避免 render 里读时钟。 */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    // 后台时 setInterval 会被系统挂起，锁屏两小时回来第一眼会是旧文案，回到前台立刻对一次表。
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  /** 到点提醒 = 系统通知权限。从系统设置回来也要重新读一次。 */
  const [notify, setNotify] = useState<NotifyPermission | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const refresh = () => {
        readNotifyPermission().then((next) => {
          if (active) setNotify(next);
        });
      };
      refresh();
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") refresh();
      });
      return () => {
        active = false;
        sub.remove();
      };
    }, [])
  );

  const planned = weekDays.reduce((total, key) => total + Object.keys(plan[key] ?? {}).length, 0);
  const toBuy = shoppingItems.length - shoppingItems.filter((item) => item.checked).length;

  // 灶台写的是「本周」，不能跟着计划页的 weekAnchor 走，否则翻到下周就成了假的「本周」。
  const today = new Date(now);
  const todayKey = toKey(today);
  const thisWeekStart = startOfWeek(today);
  const thisWeekDays = Array.from({ length: 7 }, (_, index) => toKey(addDays(thisWeekStart, index)));
  const cookedThisWeekReal = cookedLog.filter((entry) => thisWeekDays.includes(entry.date)).length;
  const cookedDays = new Set(cookedLog.map((entry) => entry.date));
  const stove = thisWeekDays.map((key) => {
    const date = parseKey(key);
    return { key, on: cookedDays.has(key), today: key === todayKey, label: `周${WEEKDAY_SHORT[date.getDay()]}` };
  });
  const stoveHint = (() => {
    const todayIndex = thisWeekDays.indexOf(todayKey);
    const cookedToday = cookedDays.has(todayKey);
    if (cookedThisWeekReal === 0) return "这周还没开火\n今晚来一道？";
    if (cookedToday) return "今天也开火了\n吃得真好";
    for (let index = todayIndex - 1; index >= 0; index -= 1) {
      if (!stove[index].on) return `${stove[index].label}没开火\n今晚补上？`;
    }
    return "天天都开火\n今晚继续？";
  })();

  const syncLabel = (() => {
    if (!auth.userId || syncPaused) return null;
    if (pendingCount > 0 || syncing) return null;
    if (!lastSyncedAt) return null;
    const minutes = Math.max(0, Math.floor((now - lastSyncedAt) / 60000));
    if (minutes < 1) return "已同步 · 刚刚";
    if (minutes < 60) return `已同步 · ${minutes} 分钟前`;
    const synced = new Date(lastSyncedAt);
    const pad = (value: number) => `${value}`.padStart(2, "0");
    const clock = `${pad(synced.getHours())}:${pad(synced.getMinutes())}`;
    if (toKey(synced) === toKey(new Date(now))) return `已同步 · 今天 ${clock}`;
    const yearPrefix = synced.getFullYear() === new Date(now).getFullYear() ? "" : `${synced.getFullYear()}年`;
    return `已同步 · ${yearPrefix}${synced.getMonth() + 1}月${synced.getDate()}日 ${clock}`;
  })();

  const statusLine = isGuestSyncLine(auth.userId, syncPaused, pendingCount, syncing, syncLabel);

  const isGuest = !auth.userId;
  const displayName = isGuest ? "游客" : displayNameFor(auth.email);
  const displayInitial = displayName.slice(0, 1).toUpperCase();
  const hasGuestLeftover = guestLocalOnly && !isGuest;

  const [avatar, setAvatar] = useState<{ userId: string; uri: string | null } | null>(null);
  const avatarUri = avatar && avatar.userId === auth.userId ? avatar.uri : null;
  useEffect(() => {
    if (!auth.userId) return;
    let active = true;
    const userId = auth.userId;
    loadAvatar(userId).then((next) => {
      if (active) setAvatar({ userId, uri: next.uri });
    });
    return () => {
      active = false;
    };
  }, [auth.userId]);

  const mine = useMemo(() => [...customRecipes].reverse(), [customRecipes]);
  const recentCooked = useMemo(
    () =>
      cookedLog.slice(0, 12).flatMap((entry, index) => {
        const recipe = findRecipe(entry.recipeId);
        if (!recipe) return [];
        return [{ key: `cooked-${entry.date}-${entry.recipeId}-${index}`, recipe, meta: shortDate(entry.date) }];
      }),
    [cookedLog, findRecipe]
  );
  const coverRecipes = useMemo(() => [...mine, ...recentCooked.map((item) => item.recipe)], [mine, recentCooked]);
  const coverUris = useRecipeCoverUris(coverRecipes);
  const [coverFailed, setCoverFailed] = useState<Record<string, boolean>>({});

  const openAccount = () => router.push(isGuest ? "/sign-in" : "/account");

  const syncTone: SyncTone = (() => {
    if (isGuest) return "idle";
    if (syncPaused) return "warn";
    if (syncing) return "busy";
    if (pendingCount > 0) return "pending";
    return "ok";
  })();
  const onSyncPress = () => {
    if (isGuest) {
      router.push("/sign-in");
      return;
    }
    if (syncPaused || syncing) return;
    Haptics.selectionAsync().catch(() => {});
    syncNow();
  };

  const notifyOn = notify === "granted";
  const notifySub =
    notify === "granted"
      ? "计时到点时通知你"
      : notify === "denied"
        ? "通知已在系统中关闭"
        : "已关闭";
  const onToggleNotify = () => {
    Haptics.selectionAsync().catch(() => {});
    if (notify === "undetermined") {
      requestNotifyPermission().then((ok) => {
        setNotify(ok ? "granted" : "denied");
        show({ text: ok ? "已开启到点提醒" : "没有通知权限，请在系统设置中开启" });
      });
      return;
    }
    // 权限一旦给了，App 里收不回来；关闭和重新打开都得去系统设置。
    show({ text: notifyOn ? "请在系统设置中关闭通知" : "去系统设置里打开通知" });
    openNotificationSettings();
  };

  const backupSub = (() => {
    if (!lastExportAt) return "还没备份过";
    const date = new Date(lastExportAt);
    if (Number.isNaN(date.getTime())) return "导出或导入全部数据";
    return `上次备份 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  })();

  const signOut = () => {
    setSignOutOpen(false);
    auth.signOut().then(() => show({ text: "已退出登录" }));
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* 我 */}
        <Animated.View entering={rise(0)} style={styles.me}>
          <PressScale
            onPress={openAccount}
            to={0.92}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={isGuest ? "登录" : "查看账号与资料"}
          >
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} alt="头像" style={styles.avatarImage} resizeMode="cover" />
              ) : (
                <AppText size={26} weight="800">{displayInitial}</AppText>
              )}
            </View>
          </PressScale>
          <View style={{ flex: 1, alignItems: "flex-start" }}>
            <AppText size={24} weight="800" numberOfLines={1} style={styles.name}>{displayName}</AppText>
            <SyncPill tone={syncTone} label={statusLine} onPress={onSyncPress} />
          </View>
          <PressScale
            onPress={openAccount}
            to={0.88}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={isGuest ? "登录" : "账号与资料"}
          >
            <ChevronRightIcon size={20} color={colors.ink} />
          </PressScale>
        </Animated.View>

        {syncPaused ? (
          <Animated.View entering={rise(1)} style={styles.pauseCard}>
            <AppText size={13} weight="700" color={colors.accentText}>同步已暂停</AppText>
            <AppText size={12} color={colors.muted} style={{ marginTop: 3, lineHeight: 18 }}>
              {syncPaused}
            </AppText>
          </Animated.View>
        ) : null}

        {/* 本周灶台 */}
        <Animated.View entering={rise(1)} style={styles.week}>
          <View style={styles.weekHead}>
            <View style={styles.bigRow}>
              <AppText size={44} weight="800" color={colors.white} style={styles.big}>{cookedThisWeekReal}</AppText>
              <AppText size={16} weight="700" color="rgba(255,255,255,0.7)" style={{ marginLeft: 4 }}>
                道 · 本周做过
              </AppText>
            </View>
            <AppText size={13} color="rgba(255,255,255,0.72)" style={styles.weekHint}>{stoveHint}</AppText>
          </View>
          <View style={styles.stove}>
            {stove.map((day, index) => (
              <View key={day.key} style={styles.stoveCell}>
                <View style={[styles.burner, day.on && styles.burnerOn, day.today && styles.burnerToday]}>
                  {day.on ? <Flame delay={index % 2 === 1 ? 400 : 0} /> : <BurnerOff />}
                </View>
                <AppText size={11.5} weight={day.today ? "700" : "400"} color={day.today ? colors.white : "rgba(255,255,255,0.6)"}>
                  {day.today ? "今天" : day.label}
                </AppText>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* 三格数字 */}
        <Animated.View entering={rise(2)} style={styles.trio}>
          <Stat value={planned} label="计划中的餐" onPress={() => router.navigate("/plan")} />
          <Stat value={favorites.length} label="收藏" onPress={() => router.navigate("/favorites")} />
          <Stat value={toBuy} label="待买食材" onPress={() => router.push("/shopping-list")} />
        </Animated.View>

        {/* 我的自建菜谱 */}
        <Animated.View entering={rise(3)}>
          <SectionHead title="我的自建菜谱" count={mine.length ? `${mine.length} 道` : undefined} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hs}>
            {mine.map((recipe, index) => (
              <View key={recipe.id} style={styles.hsTile}>
                <RecipeTile
                  recipe={recipe}
                  artHeight={TILE_ART}
                  columnWidth={TILE_W}
                  coverUri={coverUris[recipe.id]}
                  coverFailed={coverFailed[recipe.id]}
                  onCoverError={() => setCoverFailed((prev) => ({ ...prev, [recipe.id]: true }))}
                  meta={recipe.subtitle || recipeMeta(recipe.minutes, recipe.steps.length)}
                  tint={TINTS[index % TINTS.length]}
                  titleSize={14}
                  titleLines={1}
                />
              </View>
            ))}
            <PressScale
              onPress={() => router.push("/create-recipe")}
              style={[styles.newTile, mine.length === 0 && { height: TILE_ART + 46 }]}
              accessibilityRole="button"
              accessibilityLabel="新建一道菜谱"
            >
              <PlusIcon size={22} color={colors.muted} />
              <AppText size={14} weight="700" color={colors.muted}>新建一道</AppText>
            </PressScale>
          </ScrollView>
        </Animated.View>

        {/* 最近做过 */}
        {recentCooked.length > 0 ? (
          <Animated.View entering={rise(4)}>
            <SectionHead title="最近做过" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hs}>
              {recentCooked.map((item, index) => (
                <View key={item.key} style={styles.hsTile}>
                  <RecipeTile
                    recipe={item.recipe}
                    artHeight={TILE_ART}
                    columnWidth={TILE_W}
                    coverUri={coverUris[item.recipe.id]}
                    coverFailed={coverFailed[item.recipe.id]}
                    onCoverError={() => setCoverFailed((prev) => ({ ...prev, [item.recipe.id]: true }))}
                    meta={item.meta}
                    tint={TINTS[(index + 2) % TINTS.length]}
                    titleSize={14}
                    titleLines={1}
                  />
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}

        {/* 设置 */}
        <Animated.View entering={rise(5)}>
          <SectionHead title="设置" />
          <View style={styles.group}>
            {hasGuestLeftover ? (
              <SettingRow
                icon={<SyncIcon size={19} color={colors.leafText} />}
                tint={colors.leafSoft}
                title="合并本机数据"
                sub="有未并入账号的本机改动"
                onPress={reopenGuestMerge}
              />
            ) : null}
            {notify && notify !== "unavailable" ? (
              <SettingRow
                icon={<BellIcon size={19} color={colors.accentText} />}
                tint={colors.accentSoft}
                title="到点提醒"
                sub={notifySub}
                right={<Toggle on={notifyOn} onPress={onToggleNotify} label="到点提醒" />}
              />
            ) : null}
            <SettingRow
              icon={<BoxIcon size={19} color={colors.ink} />}
              tint={colors.skySoft}
              title="导出或导入备份"
              sub={backupSub}
              onPress={() => setBackupOpen(true)}
            />
            <SettingRow
              icon={<UserIcon size={19} color={colors.sunText} />}
              tint={colors.sunSoft}
              title={isGuest ? "登录 / 注册" : "账号与资料"}
              sub={isGuest ? "多设备同步菜单和收藏" : auth.email ?? "已登录"}
              onPress={openAccount}
              last
            />
          </View>
          {!isGuest ? (
            <View style={[styles.group, { marginTop: spacing.md }]}>
              <SettingRow
                icon={<LogoutIcon size={19} color={colors.danger} />}
                tint={colors.accentSoft}
                title="退出登录"
                danger
                onPress={() => setSignOutOpen(true)}
                last
              />
            </View>
          ) : null}
          <AppText size={12} color={colors.muted} style={styles.version}>{`好好吃饭 ${APP_VERSION}`}</AppText>
        </Animated.View>
      </ScrollView>

      <Toast toast={toast} bottom={spacing.lg} onUndo={undo} />

      {backupOpen ? <BackupSheet onClose={() => setBackupOpen(false)} /> : null}

      {signOutOpen ? (
        <ConfirmDialog
          title="确定要退出登录吗？"
          message="本机数据会保留，重新登录即可继续同步。"
          confirmLabel="退出登录"
          destructive
          onCancel={() => setSignOutOpen(false)}
          onConfirm={signOut}
        />
      ) : null}
    </View>
  );
}

const TINTS = [colors.accentSoft, colors.sunSoft, colors.leafSoft, colors.skySoft];

/** 同步那行只在有内容时给一句，别出现「未同步」这种没信息量的默认文案。 */
function isGuestSyncLine(
  userId: string | null,
  syncPaused: string | null,
  pendingCount: number,
  syncing: boolean,
  syncLabel: string | null
): string {
  if (!userId) return "登录后自动同步";
  if (syncPaused) return "同步已暂停";
  if (syncing) return "正在同步…";
  if (pendingCount > 0) return `${pendingCount} 项待推送 · 点按同步`;
  return syncLabel ?? "已同步";
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

function SectionHead({ title, count }: { title: string; count?: string }) {
  return (
    <View style={styles.sectionHead}>
      <AppText size={20} weight="800" style={{ letterSpacing: -0.3 }}>{title}</AppText>
      {count ? <AppText size={13} weight="600" color={colors.muted}>{count}</AppText> : null}
    </View>
  );
}

type SyncTone = "idle" | "ok" | "busy" | "pending" | "warn";

const SYNC_TONES: Record<SyncTone, { bg: string; fg: string }> = {
  idle: { bg: colors.surfaceAlt, fg: colors.muted },
  ok: { bg: colors.leafSoft, fg: colors.leafText },
  busy: { bg: colors.surfaceAlt, fg: colors.muted },
  pending: { bg: colors.sunSoft, fg: colors.sunText },
  warn: { bg: colors.accentSoft, fg: colors.accentText },
};

/** 名字下面的同步胶囊：已同步是叶子绿，正在同步时图标转圈。 */
function SyncPill({ tone, label, onPress }: { tone: SyncTone; label: string; onPress: () => void }) {
  const spin = useSharedValue(0);
  const busy = tone === "busy";
  useEffect(() => {
    if (busy) {
      spin.set(0);
      spin.set(withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1, false));
    } else {
      cancelAnimation(spin);
      spin.set(withTiming(0, { duration: motion.duration.fast }));
    }
  }, [busy, spin]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const { bg, fg } = SYNC_TONES[tone];
  const showSyncIcon = tone === "busy" || tone === "pending";
  return (
    <PressScale
      onPress={onPress}
      disabled={tone === "busy" || tone === "warn"}
      style={[styles.sync, { backgroundColor: bg }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={spinStyle}>
        {showSyncIcon ? <SyncIcon size={15} color={fg} /> : <CloudIcon size={15} color={fg} />}
      </Animated.View>
      <AppText size={12.5} weight="700" color={fg} numberOfLines={1}>{label}</AppText>
    </PressScale>
  );
}

function Stat({ value, label, onPress }: { value: number; label: string; onPress: () => void }) {
  return (
    <PressScale onPress={onPress} style={styles.stat} accessibilityRole="button" accessibilityLabel={`${label} ${value}`}>
      <AppText size={22} weight="800" style={{ letterSpacing: -0.4 }}>{value}</AppText>
      <AppText size={12.5} color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>{label}</AppText>
    </PressScale>
  );
}

function SettingRow({
  icon,
  tint,
  title,
  sub,
  onPress,
  right,
  danger,
  last,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  sub?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  last?: boolean;
}) {
  const body = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <AppText size={15} weight="700" color={danger ? colors.danger : colors.ink}>{title}</AppText>
        {sub ? (
          <AppText size={12.5} color={colors.muted} numberOfLines={1} style={{ marginTop: 2 }}>{sub}</AppText>
        ) : null}
      </View>
      {right ?? (onPress && !danger ? <ChevronRightIcon size={18} color={colors.placeholder} /> : null)}
    </>
  );
  // 有开关的行本身不能是按钮：web 端 button 里不能再套 button。
  if (!onPress) return <View style={[styles.row, last && styles.rowLast]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && { backgroundColor: colors.surfaceAlt }]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {body}
    </Pressable>
  );
}

/** 开关：iOS 白圆点滑过去；Android 走 M3（小圆点长大变白）。 */
function Toggle({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  const progress = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    progress.set(withSpring(on ? 1 : 0, motion.spring));
  }, [on, progress]);
  const track = useAnimatedStyle(() =>
    IS_ANDROID
      ? {
          backgroundColor: interpolateColor(progress.value, [0, 1], [colors.surfaceAlt, colors.leafText]),
          borderColor: interpolateColor(progress.value, [0, 1], [colors.placeholder, colors.leafText]),
        }
      : { backgroundColor: interpolateColor(progress.value, [0, 1], [colors.border, colors.leaf]) }
  );
  const thumb = useAnimatedStyle(() => {
    if (!IS_ANDROID) return { transform: [{ translateX: progress.value * 20 }] };
    const size = 16 + progress.value * 8;
    return {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: interpolateColor(progress.value, [0, 1], [colors.placeholder, colors.white]),
      transform: [{ translateX: progress.value * 16 }],
    };
  });
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
    >
      <Animated.View style={[IS_ANDROID ? styles.trackAndroid : styles.track, track]}>
        <Animated.View style={[IS_ANDROID ? styles.thumbAndroid : styles.thumb, thumb]} />
      </Animated.View>
    </Pressable>
  );
}

/** 开过火的那天：火苗一胀一缩地跳（设计稿 flick）。 */
function Flame({ delay }: { delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 800, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 800, easing: Easing.inOut(Easing.sin) })
          ),
          -1,
          false
        )
      )
    );
    return () => cancelAnimation(t);
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    transformOrigin: "bottom",
    transform: [
      { scaleX: 1 + t.value * 0.08 },
      { scaleY: 1 - t.value * 0.06 },
      { rotate: `${-3 * t.value}deg` },
    ],
  }));
  return (
    <Animated.View style={[styles.flame, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 24 24">
        <Path
          d="M12 22c4.4 0 7-2.8 7-6.6 0-4-3.2-6-4.2-10-2 1.5-2.8 3.6-2.8 5.2-1.4-1-2.2-2.4-2.3-3.9C7.2 8.6 5 11.5 5 15.4 5 19.2 7.6 22 12 22z"
          fill={FLAME_OUTER}
        />
        <Path
          d="M12 22c2 0 3.4-1.3 3.4-3.2 0-2-1.7-3-2.2-5-1 .8-1.6 1.8-1.6 2.8-.7-.5-1.1-1.1-1.2-1.9-1.2 1-1.8 2.4-1.8 4.1 0 1.9 1.4 3.2 3.4 3.2z"
          fill={colors.sun}
        />
      </Svg>
    </Animated.View>
  );
}

function BurnerOff() {
  return (
    <View style={styles.flame}>
      <Svg width="100%" height="100%" viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={6} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={2} strokeDasharray="3 3" />
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------------ 本页图标 */

type IconProps = { size?: number; color?: string };

function CloudIcon({ size = 16, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.5 7.5z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SyncIcon({ size = 16, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.5 3v4h-4M6.5 21v-4h4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function BellIcon({ size = 19, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function BoxIcon({ size = 19, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5zM4 8.5 12 13l8-4.5M12 13v7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  me: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: PAD, paddingTop: spacing.sm },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.sun,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    transform: [{ rotate: "-5deg" }],
  },
  avatarImage: { width: "100%", height: "100%" },
  name: { letterSpacing: -0.5, lineHeight: 30 },
  sync: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginTop: 4,
    maxWidth: "100%",
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
  pauseCard: {
    marginHorizontal: PAD,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  week: {
    marginHorizontal: PAD,
    marginTop: PAD,
    padding: 18,
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
  },
  weekHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: spacing.md },
  bigRow: { flexDirection: "row", alignItems: "baseline", flexShrink: 1 },
  big: { lineHeight: 46, letterSpacing: -1.2 },
  weekHint: { textAlign: "right", lineHeight: 18 },
  stove: { flexDirection: "row", gap: 6, marginTop: spacing.lg },
  stoveCell: { flex: 1, alignItems: "center", gap: 4 },
  burner: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  burnerOn: { backgroundColor: "rgba(255,255,255,0.12)" },
  burnerToday: { borderWidth: 2, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.35)" },
  flame: { width: "60%", height: "60%" },
  trio: { flexDirection: "row", gap: 10, marginHorizontal: PAD, marginTop: spacing.md },
  stat: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: PAD,
    marginTop: 26,
    marginBottom: 12,
  },
  hs: { gap: 12, paddingHorizontal: PAD },
  hsTile: { width: TILE_W },
  newTile: {
    width: TILE_W,
    alignSelf: "stretch",
    minHeight: TILE_ART,
    borderRadius: IS_ANDROID ? 16 : radius.md,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
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
  track: { width: 52, height: 32, borderRadius: 16, padding: 2, justifyContent: "center" },
  thumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.white,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  trackAndroid: {
    width: 52,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    paddingLeft: 4,
    justifyContent: "center",
  },
  thumbAndroid: { width: 16, height: 16, borderRadius: 8 },
  version: { textAlign: "center", marginTop: spacing.xl },
});
