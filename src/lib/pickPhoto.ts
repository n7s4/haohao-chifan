/**
 * 选图 + 压图。只做两件事：拿到本地临时文件、把长边压到 1600 以内。
 *
 * 原图直传的后果很具体：一张手机 HEIC 4~8MB，超过桶的 5MB 上限，
 * 上传直接失败；就算不失败，一屏 20 张也跟着卡。
 *
 * 压图（manipulateAsync）在手机上要 1~3 秒，所以**先把原图交给界面预览**，
 * 压缩在后台跑完再替换 localUri——用户点完相册立刻就看见图，而不是盯着转圈。
 */
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { getThumbnailAsync } from "expo-video-thumbnails";

export type PickedPhoto = { uri: string; width: number; height: number };

/** `preview` 可以立刻上屏；`ready` 是压好的版本，保存时用它。 */
export type PickedDraft = { preview: PickedPhoto; ready: Promise<PickedPhoto> };

const MAX_EDGE = 1600;
const QUALITY = 0.7;

/** 全局唯一的图片 id：`step-1` 这种页面内自增会跨菜谱撞车，见 imageId 的说明。 */
export function newImageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function compress(asset: PickedPhoto): Promise<PickedPhoto> {
  const { width, height } = asset;
  const actions =
    width >= height && width > MAX_EDGE
      ? [{ resize: { width: MAX_EDGE } }]
      : height > width && height > MAX_EDGE
        ? [{ resize: { height: MAX_EDGE } }]
        : [];
  const result = await manipulateAsync(asset.uri, actions, {
    compress: QUALITY,
    format: SaveFormat.JPEG,
  });
  return {
    uri: result.uri,
    width: result.width || width || 0,
    height: result.height || height || 0,
  };
}

const EMPTY = "没有选到图片";

function draft(asset: ImagePicker.ImagePickerAsset | undefined): PickedDraft {
  if (!asset?.uri) throw new Error(EMPTY);
  const preview: PickedPhoto = { uri: asset.uri, width: asset.width ?? 0, height: asset.height ?? 0 };
  return { preview, ready: compress(preview) };
}

export async function pickFromLibrary(): Promise<PickedDraft | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("需要相册权限才能选图，去系统设置里打开");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled) return null;
  return draft(result.assets?.[0]);
}

// ---------------------------------------------------------------- AI 导入截图
/**
 * 导入用的截图和步骤图不一样：笔记里的「配方卡」小字很多（941×1672 竖图里写着
 * 「生抽 2 勺 / 老抽半勺」），压到 1024 会让模型把「半勺」读成「1 勺」——而且这种错
 * 在结果里看不出来。所以留 1600 / 0.8，一张 300KB 级，多张也在请求体预算内。
 */
const SCREENSHOT_EDGE = 1600;
const SCREENSHOT_QUALITY = 0.8;

async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<PickedPhoto> {
  const { width, height } = asset;
  const actions =
    width >= height && width > SCREENSHOT_EDGE
      ? [{ resize: { width: SCREENSHOT_EDGE } }]
      : height > width && height > SCREENSHOT_EDGE
        ? [{ resize: { height: SCREENSHOT_EDGE } }]
        : [];
  const resized = await manipulateAsync(asset.uri, actions, {
    compress: SCREENSHOT_QUALITY,
    format: SaveFormat.JPEG,
  });
  return { uri: resized.uri, width: resized.width || width || 0, height: resized.height || height || 0 };
}

/**
 * 一次最多选 `limit` 张。压缩按 3 并行走：9 张同时 manipulateAsync 在低端安卓上会卡住主线程，
 * 串行又要等十几秒，用户以为没反应。
 */
export async function pickScreenshots(limit: number): Promise<PickedPhoto[]> {
  if (limit <= 0) return [];
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("需要相册权限才能选截图，去系统设置里打开");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1,
  });
  if (result.canceled) return [];
  const assets = (result.assets ?? []).filter((asset) => asset.uri).slice(0, limit);
  if (!assets.length) throw new Error(EMPTY);

  const out: PickedPhoto[] = new Array(assets.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < assets.length) {
      const index = cursor++;
      out[index] = await shrink(assets[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, assets.length) }, worker));
  return out;
}

/**
 * AI 导入后挑出来的封面 / 步骤图落成菜谱图片：远程的（小红书）带 Referer 下载，
 * 本地截图直接用；都按封面同样的规格压一遍（顺便拿到宽高，瀑布流要按比例排）。
 * 失败返回 null，调用方当没有图处理。
 */
export async function importedPhoto(uri: string): Promise<PickedPhoto | null> {
  if (!/^https?:\/\//i.test(uri)) {
    try {
      return await compress({ uri, width: 0, height: 0 });
    } catch {
      return null;
    }
  }
  if (!/^https:\/\//i.test(uri)) return null;
  const url = uri;
  const target = `${FileSystem.cacheDirectory}xhs-cover-${newImageId()}.img`;
  try {
    const result = await FileSystem.downloadAsync(url, target, {
      headers: { Referer: "https://www.xiaohongshu.com/" },
    });
    if (result.status < 200 || result.status >= 300) return null;
    const original = await manipulateAsync(target, [], { format: SaveFormat.JPEG });
    return await compress({ uri: original.uri, width: original.width, height: original.height });
  } catch {
    return null;
  } finally {
    FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  }
}

/**
 * 视频笔记的步骤图：按 AI 标的秒数从视频里截一帧，再按步骤图规格压一遍。
 * 远程视频由原生层按需拉取那一段，不用整段下载。失败返回 null，这一步就不配图。
 */
export async function videoFrame(videoUrl: string, seconds: number): Promise<PickedPhoto | null> {
  if (!/^https:\/\//i.test(videoUrl)) return null;
  try {
    const frame = await getThumbnailAsync(videoUrl, {
      time: Math.max(0, Math.round(seconds * 1000)),
      quality: 0.9,
      headers: { Referer: "https://www.xiaohongshu.com/" },
    });
    const photo = await compress({ uri: frame.uri, width: frame.width, height: frame.height });
    if (photo.uri !== frame.uri) FileSystem.deleteAsync(frame.uri, { idempotent: true }).catch(() => {});
    return photo;
  } catch {
    return null;
  }
}

export async function takePhoto(): Promise<PickedDraft | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error("需要相机权限才能拍照，去系统设置里打开");
  const result = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false });
  if (result.canceled) return null;
  return draft(result.assets?.[0]);
}

// ---------------------------------------------------------------- 头像
const AVATAR_SIZE = 512;

/** 头像不需要 1600：中心裁 1:1、压到 512 方，尺寸小也省一次上传往返。 */
async function squareAvatar(asset: PickedPhoto): Promise<PickedPhoto> {
  const side = Math.min(asset.width || 0, asset.height || 0);
  const actions =
    side > 0
      ? [
          {
            crop: {
              originX: Math.max(0, Math.round(((asset.width || side) - side) / 2)),
              originY: Math.max(0, Math.round(((asset.height || side) - side) / 2)),
              width: side,
              height: side,
            },
          },
          { resize: { width: AVATAR_SIZE } },
        ]
      : [{ resize: { width: AVATAR_SIZE } }];
  const result = await manipulateAsync(asset.uri, actions, {
    compress: 0.85,
    format: SaveFormat.JPEG,
  });
  return { uri: result.uri, width: result.width, height: result.height };
}

export async function pickAvatarFromLibrary(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("需要相册权限才能换头像，去系统设置里打开");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error(EMPTY);
  const square = await squareAvatar({
    uri: asset.uri,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
  });
  return square.uri;
}

export async function takeAvatarPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error("需要相机权限才能拍照，去系统设置里打开");
  const result = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error(EMPTY);
  const square = await squareAvatar({
    uri: asset.uri,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
  });
  return square.uri;
}
