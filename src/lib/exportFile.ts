import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/** 把备份 JSON 交给系统：Web 直接下载，原生写进缓存目录再走系统分享。 */
export async function saveJsonFile(json: string, name: string) {
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
    return { shared: true as const, uri: null };
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      dialogTitle: "保存好好吃饭备份",
      UTI: "public.json",
    });
    return { shared: true as const, uri: file.uri };
  }
  return { shared: false as const, uri: file.uri };
}

const pad = (value: number) => `${value}`.padStart(2, "0");
const stampOf = (now: Date) =>
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

export function backupFileName(now = new Date()) {
  return `haohao-chifan-${stampOf(now)}.json`;
}

/** 游客那份单独命名，免得和账号备份混在同一个下载目录里分不清。 */
export function guestBackupFileName(now = new Date()) {
  return `haohao-chifan-guest-${stampOf(now)}.json`;
}

/** 备份时间的可读文案：`10月26日 13:49`。导入确认框用它让用户判断新旧。 */
export function readableStamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 给用户看的可读时间：`好好吃饭·游客备份 10月26日 13:49`。 */
export function guestBackupLabel(now = new Date()) {
  return `好好吃饭·游客备份 ${readableStamp(now)}`;
}
