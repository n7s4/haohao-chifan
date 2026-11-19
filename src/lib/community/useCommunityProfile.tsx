import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { NicknameSheet } from "../../components/community/NicknameSheet";
import { loadAvatar, mirrorPublicAvatar } from "../account";
import { getSupabase } from "../supabase";
import { useAuth } from "../useAuth";
import { validateNickname } from "./logic";
import {
  cleanupWithdrawnMedia,
  ensurePublicProfile,
  getProfiles,
  renamePublicProfile,
  type FailReason,
  type Result,
} from "./api";

export type CommunityProfile = { nickname: string };

type Ctx = {
  profile: CommunityProfile | null;
  /** 有公开资料 → true；没有则弹昵称弹层：确认 true，取消 false；未登录直接 false（调用方去登录）。 */
  ensure: () => Promise<boolean>;
  rename: (nickname: string) => Promise<Result<void>>;
  /** 上次读取自己的资料失败了（此时 profile 为 null 不代表没起过名）。 */
  loadFailed: boolean;
  /** 重新读取：返回资料 / null（确认没有）/ "error"（读取失败）。 */
  reload: () => Promise<CommunityProfile | null | "error">;
};

const CommunityProfileContext = createContext<Ctx>({
  profile: null,
  ensure: async () => false,
  rename: async () => ({ ok: false, reason: "auth" }),
  loadFailed: false,
  reload: async () => "error",
});

export const useCommunityProfile = () => useContext(CommunityProfileContext);

export const failMessage = (reason: FailReason): string =>
  reason === "network" ? "网络不太好，稍后再试" : reason === "auth" ? "登录状态失效了，重新登录后再试" : "没保存成功，再试一次";

export function CommunityProfileProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  // 状态都带着所属 userId，换账号时自然失效，不必在 effect 里同步清 state。
  const [owned, setOwned] = useState<{ userId: string; profile: CommunityProfile } | null>(null);
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const profile = owned && owned.userId === userId ? owned.profile : null;
  const asking = askingFor !== null && askingFor === userId;
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const loadFailed = failedFor !== null && failedFor === userId;
  const userRef = useRef<string | null>(null);
  const profileRef = useRef<CommunityProfile | null>(null);
  const loadRef = useRef<Promise<void>>(Promise.resolve());
  const failedRef = useRef(false);
  const pendingRef = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    pendingRef.current?.(ok);
    pendingRef.current = null;
    setAskingFor(null);
  }, []);

  const apply = useCallback((uid: string, next: CommunityProfile) => {
    profileRef.current = next;
    setOwned({ userId: uid, profile: next });
  }, []);

  const load = useCallback(async (uid: string): Promise<CommunityProfile | null | "error"> => {
    const r = await getProfiles(getSupabase(), [uid]).catch(() => null);
    if (userRef.current !== uid) return "error";
    if (!r || !r.ok) {
      failedRef.current = true;
      setFailedFor(uid);
      return "error";
    }
    failedRef.current = false;
    setFailedFor(null);
    const mine = r.value.get(uid);
    if (!mine) return null;
    const next = { nickname: mine.nickname };
    apply(uid, next);
    return next;
  }, [apply]);

  const reload = useCallback(async () => {
    const uid = userRef.current;
    if (!uid) return "error" as const;
    const result = await load(uid);
    return result;
  }, [load]);

  // 每个登录用户只加载一次；登出 / 换账号时清空，并放弃还在等的 ensure()。
  useEffect(() => {
    userRef.current = userId;
    profileRef.current = null;
    failedRef.current = false;
    // 放弃还在等的 ensure()；asking 由 userId 派生，不需要在这里 setState。
    pendingRef.current?.(false);
    pendingRef.current = null;
    if (!userId) {
      loadRef.current = Promise.resolve();
      return;
    }
    // 放到微任务里：load 会 setState，不能在 effect 体内同步调用。
    loadRef.current = Promise.resolve().then(() => load(userId)).then(() => {});
  }, [userId, load]);

  // 每次登录（含冷启动恢复会话）清一次：已撤回的菜（含另一台设备删菜触发的撤回）若公开桶还有图就删掉。
  // 尽力而为，失败只告警；游客不跑。
  useEffect(() => {
    if (!userId) return;
    cleanupWithdrawnMedia(getSupabase(), userId).catch((failure) =>
      console.warn("[community] 清理已撤回菜的公开图片失败", failure)
    );
  }, [userId]);

  const ensure = useCallback(async () => {
    const uid = userRef.current;
    if (!uid) return false;
    await loadRef.current;
    if (userRef.current !== uid) return false;
    if (profileRef.current) return true;
    // 上次读取失败：先重试，仍失败就不能当作「没起过名」去建档。
    if (failedRef.current && (await load(uid)) === "error") return false;
    if (userRef.current !== uid) return false;
    if (profileRef.current) return true;
    settle(false); // 同时只留一个弹层
    return new Promise<boolean>((resolve) => {
      pendingRef.current = resolve;
      setAskingFor(uid);
    });
  }, [settle, load]);

  const rename = useCallback(async (nickname: string): Promise<Result<void>> => {
    const uid = userRef.current;
    if (!uid) return { ok: false, reason: "auth" };
    const valid = validateNickname(nickname);
    const r = await renamePublicProfile(getSupabase(), uid, nickname);
    if (r.ok && userRef.current === uid) apply(uid, { nickname: valid.ok ? valid.value : nickname });
    return r;
  }, [apply]);

  const confirmNickname = useCallback(async (nickname: string): Promise<string | null> => {
    const uid = userRef.current;
    if (!uid) return failMessage("auth");
    const client = getSupabase();
    const created = await ensurePublicProfile(client, uid, nickname);
    if (!created.ok) return failMessage(created.reason);
    // 已有行时 ensure 不覆盖昵称，以库里为准。
    const mine = await getProfiles(client, [uid]);
    const stored = mine.ok ? mine.value.get(uid)?.nickname : undefined;
    if (userRef.current === uid) apply(uid, { nickname: stored ?? nickname });
    // 首次建档顺带把已有私有头像公开一次；失败只告警。
    void (async () => {
      const avatar = await loadAvatar(uid);
      if (avatar.path) await mirrorPublicAvatar(uid, avatar.path);
    })().catch((failure) => console.warn("[community] 公开头像同步失败", failure));
    settle(true);
    return null;
  }, [apply, settle]);

  const value = useMemo(
    () => ({ profile, ensure, rename, loadFailed, reload }),
    [profile, ensure, rename, loadFailed, reload],
  );

  return (
    <CommunityProfileContext.Provider value={value}>
      {children}
      {asking ? <NicknameSheet onConfirm={confirmNickname} onCancel={() => settle(false)} /> : null}
    </CommunityProfileContext.Provider>
  );
}
