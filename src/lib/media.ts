/**
 * 菜谱图片：Storage 存取 + 本地磁盘缓存。
 *
 * 只存路径不存 URL：云端 jsonb 里放的是 `{userId}/{recipeId}/{imageId}.jpg`，
 * 签名 URL 一小时就过期，落到存档里全是废链。本地缓存**用同一个相对路径**
 * （`document/recipe-media/{userId}/{recipeId}/{imageId}.jpg`），一份函数算两处，
 * 云端和本地永远对得上。
 *
 * 游客态（未登录）没有 userId，本地落到 `guest/` 下，上传时再搬到 `{userId}/`。
 */
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { getSupabase } from "./supabase";

export const MEDIA_BUCKET = "recipe-media";

/** 签名有效期；缓存提前 5 分钟失效，避免正好卡在边界上拿到刚过期的地址。 */
const SIGNED_TTL = 3600;
const SIGNED_CACHE_SLACK = 300;

/** 本地缓存上限与下载并发：图片会越存越多，documentDirectory 系统不会帮你清。 */
const CACHE_LIMIT_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 3;

export type MediaRef = { userId: string | null; recipeId: string; imageId: string };

/** 云端对象 key，同时也是本地缓存的相对路径；游客态没有云端 key。 */
export function mediaPath({ userId, recipeId, imageId }: MediaRef): string | null {
  if (!userId) return null;
  return `${userId}/${recipeId}/${imageId}.jpg`;
}

/** 本地缓存的相对分段；游客也行，落 `guest/`。 */
function cacheSegments(ref: MediaRef): string[] {
  return [ref.userId ?? "guest", ref.recipeId, `${ref.imageId}.jpg`];
}

const signedCache = new Map<string, { url: string; expiresAt: number }>();

function cacheRoot(): Directory | null {
  // Web 上没有 documentDirectory，图片走 URL 直连，不做本地落盘。
  if (Platform.OS === "web") return null;
  try {
    const dir = new Directory(Paths.document, "recipe-media");
    if (!dir.exists) dir.create({ intermediates: true });
    return dir;
  } catch {
    return null;
  }
}

function cacheFile(ref: MediaRef): File | null {
  const root = cacheRoot();
  if (!root) return null;
  try {
    return new File(root, ...cacheSegments(ref));
  } catch {
    return null;
  }
}

/**
 * 已下载到本机的文件；没有就返回 null（调用方再退到签名 URL）。
 *
 * 有 userId 时先找 `{userId}/`，再找 `guest/`——游客期录的菜图片落在 guest 目录，
 * 登录后还认得出，不必在 state 里存 `localUri`（那串 file:// 换设备就是死链）。
 */
export function cachedMediaFile(ref: MediaRef): File | null {
  const own = cacheFile(ref);
  if (own?.exists) return own;
  if (!ref.userId) return null;
  const guest = cacheFile({ ...ref, userId: null });
  return guest?.exists ? guest : null;
}

/** 把本地文件搬进缓存目录（选图后、上传成功后都走这里），一次移动、不占双份空间。 */
export async function adoptLocalMedia(ref: MediaRef, localUri: string): Promise<string | null> {
  const root = cacheRoot();
  if (!root) return null;
  try {
    const dir = new Directory(root, ref.userId ?? "guest", ref.recipeId);
    if (!dir.exists) dir.create({ intermediates: true });
    const target = new File(dir, `${ref.imageId}.jpg`);
    if (target.exists && target.uri === localUri) return target.uri;
    const source = new File(localUri);
    if (!source.exists) return null;
    if (target.exists) target.delete();
    await source.move(target);
    return target.uri;
  } catch {
    // 移动失败不要紧：path 已经有效，下次渲染走签名 URL + 懒下载补回来。
    return null;
  }
}

/** 上传一张图，返回对象 key（写进 jsonb 的那串）。调用方负责压图与体积校验。 */
export async function uploadMedia(ref: MediaRef, localUri: string): Promise<string> {
  const path = mediaPath(ref);
  if (!path) throw new Error("游客态不能上传；先登录再同步");
  const file = new File(localUri);
  // 只传 ArrayBuffer：storage-js 在 RN 里的白名单是 Blob | ArrayBuffer | FormData | string，
  // 传 File 实例会靠鸭子类型碰运气，运气不好就是 0 字节对象上传成功。
  const body = file.exists
    ? await file.arrayBuffer()
    : await fetch(localUri).then((res) => res.arrayBuffer());
  // contentType 必须显式给：桶上配了 allowed_mime_types，缺省会退成
  // application/octet-stream 被直接拒掉。
  const { error } = await getSupabase()
    .storage.from(MEDIA_BUCKET)
    .upload(path, body, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return path;
}

/** 批量签名，一次请求拿齐（详情页一屏 9 张不要发 9 次）。 */
export async function signedMediaUrls(
  refs: MediaRef[],
  force = false
): Promise<Record<string, string>> {
  const pairs = refs
    .map((ref) => ({ ref, path: mediaPath(ref) }))
    .filter((item): item is { ref: MediaRef; path: string } => Boolean(item.path));
  const now = Date.now();
  const result: Record<string, string> = {};
  const missing: string[] = [];

  for (const { path } of pairs) {
    const hit = force ? undefined : signedCache.get(path);
    if (hit && hit.expiresAt > now) result[path] = hit.url;
    else missing.push(path);
  }
  if (!missing.length) return result;

  const { data, error } = await getSupabase()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrls(missing, SIGNED_TTL);
  if (error) throw error;

  for (const item of data ?? []) {
    if (!item.path || !item.signedUrl) continue;
    result[item.path] = item.signedUrl;
    signedCache.set(item.path, {
      url: item.signedUrl,
      expiresAt: now + (SIGNED_TTL - SIGNED_CACHE_SLACK) * 1000,
    });
  }
  return result;
}

// ---------------------------------------------------------------- 下载并发
let activeDownloads = 0;
const waiters: (() => void)[] = [];

function acquire(): Promise<void> {
  if (activeDownloads < DOWNLOAD_CONCURRENCY) {
    activeDownloads += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  activeDownloads -= 1;
  const next = waiters.shift();
  if (next) {
    activeDownloads += 1;
    next();
  }
}

/** 拉到本地：断网前先存下来，厨房里没信号也能看。返回本地 file:// 地址。 */
export async function downloadMedia(ref: MediaRef, url: string): Promise<string | null> {
  const target = cacheFile(ref);
  if (!target) return null;
  if (target.exists) return target.uri;
  await acquire();
  try {
    const dir = new Directory(target.uri.replace(/\/[^/]+$/, ""));
    if (!dir.exists) dir.create({ intermediates: true });
    const downloaded = await File.downloadFileAsync(url, target);
    void trimCacheIfNeeded();
    return downloaded.uri;
  } catch {
    return null;
  } finally {
    release();
  }
}

/**
 * `local → 签名 URL → 占位` 的唯一入口。签名过期/超时时重签一次再试，
 * 别一次失败就落占位——厨房弱网下那会是一整屏灰块。
 */
export async function resolveMediaUri(ref: MediaRef): Promise<string | null> {
  const local = cachedMediaFile(ref);
  if (local) return local.uri;

  const path = mediaPath(ref);
  if (!path) return null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const url = (await signedMediaUrls([ref], attempt > 0))[path];
      if (!url) return null;
      const uri = await downloadMedia(ref, url);
      if (uri) return uri;
    } catch {
      // 重签一次再试；仍失败就交给调用方显示占位。
    }
  }
  return null;
}

// ------------------------------------------------------------------ 缓存清理
function walk(dir: Directory, files: File[] = []): File[] {
  for (const item of dir.list()) {
    if (item instanceof Directory) walk(item, files);
    else files.push(item);
  }
  return files;
}

let trimming = false;

/** 超上限就按 mtime 最旧的先删（LRU 近似）。每次下载成功后顺手跑一次。 */
export async function trimCacheIfNeeded(): Promise<void> {
  if (trimming) return;
  const root = cacheRoot();
  if (!root) return;
  trimming = true;
  try {
    const files = walk(root);
    const total = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
    if (total <= CACHE_LIMIT_BYTES) return;
    const ordered = [...files].sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0));
    let remaining = total;
    for (const file of ordered) {
      if (remaining <= CACHE_LIMIT_BYTES) break;
      remaining -= file.size ?? 0;
      try {
        file.delete();
      } catch {
        // 单个文件删不掉就跳过，不影响其他。
      }
    }
  } catch {
    // 列目录失败不算错，下次再试。
  } finally {
    trimming = false;
  }
}

/** 删图时 Storage 里的对象不会自己消失，按前缀列一遍再清，避免留孤儿。 */
export async function removeRecipeMedia(ref: Pick<MediaRef, "userId" | "recipeId">): Promise<void> {
  const prefix = ref.userId ? `${ref.userId}/${ref.recipeId}` : null;
  if (prefix) {
    try {
      const { data, error } = await getSupabase().storage.from(MEDIA_BUCKET).list(prefix, { limit: 100 });
      if (!error) {
        const paths = (data ?? []).map((item) => `${prefix}/${item.name}`);
        if (paths.length) await getSupabase().storage.from(MEDIA_BUCKET).remove(paths);
      }
    } catch {
      // 离线或权限不足时留着，下次同步再清。
    }
  }

  const root = cacheRoot();
  if (!root) return;
  try {
    const dir = new Directory(root, ref.userId ?? "guest", ref.recipeId);
    if (dir.exists) dir.delete();
  } catch {
    // 同上。
  }
}

// ---------------------------------------------------------------- 头像
/**
 * 头像和菜谱图共用同一个桶和同一套缓存，只是路径第二段固定是 `avatar`：
 * `{userId}/avatar/{imageId}.jpg`。所以复用 MediaRef，recipeId 传 "avatar" 即可，
 * 但**删除必须按精确 path**，绝不能走 removeRecipeMedia 的前缀列举。
 */
export const AVATAR_DIR = "avatar";

export function avatarRef(userId: string, imageId: string): MediaRef {
  return { userId, recipeId: AVATAR_DIR, imageId };
}

/** 从 `{userId}/avatar/{imageId}.jpg` 反解出 imageId；格式不对就当没有头像。 */
export function avatarImageId(userId: string, path: string | null | undefined): string | null {
  if (!path) return null;
  const prefix = `${userId}/${AVATAR_DIR}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".jpg")) return null;
  const id = path.slice(prefix.length, -4);
  return id.includes("/") ? null : id || null;
}

/** 头像的展示地址：先本地缓存，再签名 URL，最后下载落盘。失败返回 null（上层显示首字母）。 */
export async function resolveAvatarUri(userId: string, path: string): Promise<string | null> {
  const imageId = avatarImageId(userId, path);
  if (!imageId) return null;
  const ref = avatarRef(userId, imageId);
  const local = cachedMediaFile(ref);
  if (local) return local.uri;
  try {
    const urls = await signedMediaUrls([ref]);
    const url = urls[path];
    if (!url) return null;
    return (await downloadMedia(ref, url)) ?? url;
  } catch {
    return null;
  }
}

/** 删一个精确对象（换头像后清旧文件）：Storage 一条 + 本地缓存一条，不做前缀扫描。 */
export async function removeAvatarFile(userId: string, path: string): Promise<void> {
  const imageId = avatarImageId(userId, path);
  try {
    await getSupabase().storage.from(MEDIA_BUCKET).remove([path]);
  } catch {
    // 离线时留着，下次换头像会再清一次。
  }
  if (!imageId) return;
  const file = cacheFile(avatarRef(userId, imageId));
  try {
    if (file?.exists) file.delete();
  } catch {
    // 缓存文件删不掉不影响功能，体积由 LRU 兜底。
  }
}
