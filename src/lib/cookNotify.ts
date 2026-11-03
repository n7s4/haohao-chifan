import { isRunningInExpoGo } from "expo";
import { AppState, Linking, Platform } from "react-native";

type NotificationsModule = typeof import("expo-notifications");

const isDevicePlatform = Platform.OS === "ios" || Platform.OS === "android";

/**
 * Expo Go（Android）里 expo-notifications 的 TopicSubscriptionModule 没有原生实现，
 * 静态 import 会在模块加载阶段直接抛 `Cannot find native module`，把整个路由一起打崩。
 * 所以这里不静态引入：Android + Expo Go 直接判定为「不支持」，其它平台首次用到时再动态加载。
 */
const isExpoGoAndroid = Platform.OS === "android" && isRunningInExpoGo();

export const CHANNEL_ID = "cooking-timer";
export const notificationsSupported = isDevicePlatform && !isExpoGoAndroid;

let modulePromise: Promise<NotificationsModule | null> | null = null;

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!notificationsSupported) return null;
  if (!modulePromise) {
    modulePromise = import("expo-notifications")
      .then((mod) => {
        mod.setNotificationHandler({
          handleNotification: async () => {
            // 前台已经用震动 + 「计时完成」标签提示过了，不再叠一层横幅打断。
            const foreground = AppState.currentState === "active";
            return {
              shouldShowBanner: !foreground,
              shouldShowList: !foreground,
              shouldPlaySound: !foreground,
              shouldSetBadge: false,
            };
          },
        });
        return mod;
      })
      .catch(() => null);
  }
  return modulePromise;
}

export type NotifyPermission = "granted" | "denied" | "undetermined" | "unavailable";

/**
 * "unavailable" 专门表示「模块或原生实现根本拿不到」，和用户手动关通知的 "denied" 区分开：
 * 后者能去系统设置救回来，前者去设置里怎么开都没用，不该让用户背这个锅。
 */
export async function readNotifyPermission(): Promise<NotifyPermission> {
  const Notifications = await loadNotifications();
  if (!Notifications) return "unavailable";
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    if (current.canAskAgain) return "undetermined";
    return "denied";
  } catch {
    // 原生模块在（API 却调不通）也归到不可用，而不是误报成用户关了通知。
    return "unavailable";
  }
}

export async function requestNotifyPermission(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  try {
    // Android 13+ 没有 channel 时系统授权框可能不弹，先建好 channel 再申请。
    await ensureChannel(Notifications);
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export function openNotificationSettings() {
  Linking.openSettings().catch(() => {});
}

let channelReady: Promise<unknown> | null = null;

async function ensureChannel(Notifications: NotificationsModule) {
  if (Platform.OS !== "android") return;
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "烹饪计时",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      sound: "default",
      enableVibrate: true,
    }).catch(() => {});
  }
  await channelReady;
}

type StepNotice = {
  recipeId: string;
  recipeName: string;
  step: number;
  text: string;
  seconds: number;
};

const bodyFor = (text: string) => {
  const head = text.split(/[，。；]/)[0]?.trim();
  if (!head) return "计时结束，这一锅可以了";
  return `计时结束，${head.length > 18 ? `${head.slice(0, 18)}…` : head}`;
};

export async function scheduleStepDone({ recipeId, recipeName, step, text, seconds }: StepNotice) {
  if (!notificationsSupported || seconds <= 1) return null;
  const Notifications = await loadNotifications();
  if (!Notifications) return null;
  const content = {
    title: `${recipeName} · 第 ${step + 1} 步`,
    body: bodyFor(text),
    sound: "default",
    data: { kind: "cook-step", recipeId, step },
  };
  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(Date.now() + Math.round(seconds) * 1000),
    channelId: CHANNEL_ID,
  } as const;
  try {
    await ensureChannel(Notifications);
    try {
      return await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          ...trigger,
          ...(Platform.OS === "android" ? { delivery: "alarmClock" as const } : {}),
        },
      });
    } catch {
      // 没有精确闹钟授权时退回 bestEffort，可能晚几十秒，但不会静默丢失提醒。
      return await Notifications.scheduleNotificationAsync({ content, trigger });
    }
  } catch {
    return null;
  }
}

export async function cancelNotice(id: string | null) {
  if (!notificationsSupported || !id) return;
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already fired or removed.
  }
}
