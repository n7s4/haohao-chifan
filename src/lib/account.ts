/**
 * 账号资料：头像（Storage + profiles 表）与密码。
 *
 * 头像路径只存 `{userId}/avatar/{imageId}.jpg` 这样一串 path 进 profiles.avatar_path，
 * 不存签名 URL——签名一小时就过期，写进表里换台设备就是破图。
 */
import { avatarRef, removeAvatarFile, resolveAvatarUri, uploadMedia } from "./media";
import { newImageId } from "./pickPhoto";
import { getProfiles, syncPublicAvatar } from "./community/api";
import { getSupabase } from "./supabase";

export type Avatar = { path: string | null; uri: string | null };

/**
 * 展示名：邮箱前缀是纯数字时不要裸露账号（123456789@qq.com 看着像 ID），
 * 退成「用户 1427」；有字母就取前缀第一段（wen.xin@… → wen）。
 */
export function displayNameFor(email?: string | null, fallback = "已登录"): string {
  const prefix = email?.split("@")[0]?.trim() ?? "";
  if (!prefix) return fallback;
  if (/^\d+$/.test(prefix)) {
    return `用户 ${prefix.length > 4 ? prefix.slice(-4) : prefix}`;
  }
  const word = prefix.split(/[._\-+]/).find(Boolean) ?? prefix;
  return word;
}

/** 读当前头像路径并解析成本机可显示的地址（本地缓存 → 签名 URL → 下载）。 */
export async function loadAvatar(userId: string): Promise<Avatar> {
  let path: string | null = null;
  try {
    const { data, error } = await getSupabase()
      .from("profiles")
      .select("avatar_path")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    path = (data?.avatar_path as string | null) ?? null;
  } catch {
    // 表还没建、或断网：当作没有头像，界面上退回首字母，不阻塞页面。
    return { path: null, uri: null };
  }
  if (!path) return { path: null, uri: null };
  return { path, uri: await resolveAvatarUri(userId, path) };
}

/**
 * 换头像：上传新文件 → 写库 → 删旧文件。
 * 顺序不能反过来，任何一步失败都要保住用户原来的头像。
 */
export async function replaceAvatar(
  userId: string,
  localUri: string,
  previousPath: string | null
): Promise<Avatar> {
  const imageId = newImageId();
  const ref = avatarRef(userId, imageId);
  const path = await uploadMedia(ref, localUri);

  const { error } = await getSupabase()
    .from("profiles")
    .upsert({ id: userId, avatar_path: path, updated_at: new Date().toISOString() });
  if (error) {
    // 没写进库就没人知道这张图是头像，直接清掉，别留孤儿。
    await removeAvatarFile(userId, path);
    throw new Error(
      /relation .* does not exist|schema cache/i.test(error.message)
        ? "云端还没有 profiles 表，先在 Supabase 跑 004_profiles.sql"
        : error.message
    );
  }

  if (previousPath && previousPath !== path) await removeAvatarFile(userId, previousPath);
  // 已有公开资料才同步公开头像；失败只告警，不影响换头像本身。
  void mirrorPublicAvatar(userId, path).catch((failure) => console.warn("[community] 公开头像同步失败", failure));
  return { path, uri: await resolveAvatarUri(userId, path) };
}

/** 有公开资料时把私有头像镜像到公开桶；没有公开资料（没发过言）就什么也不做。 */
export async function mirrorPublicAvatar(userId: string, privatePath: string | null): Promise<void> {
  const client = getSupabase();
  const profiles = await getProfiles(client, [userId]);
  if (!profiles.ok || !profiles.value.has(userId)) return;
  await syncPublicAvatar(client, userId, privatePath);
}

/**
 * 改密码。成功后把**其他设备**的会话一并作废——只换密码不吊销 refresh token，
 * 等于「怀疑泄露，但旧设备照样能用」。
 */
export async function changePassword(password: string): Promise<string | null> {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("reauthentication") || message.includes("nonce") || message.includes("session"))
      return "为安全起见，请退出后重新登录再改密码";
    if (message.includes("password should be at least")) return "密码至少 6 位";
    if (message.includes("same password")) return "新密码不能和原密码一样";
    return error.message;
  }
  // 本机保持登录，其他设备的 refresh token 全部作废。
  await getSupabase().auth.signOut({ scope: "others" }).catch(() => null);
  return null;
}
