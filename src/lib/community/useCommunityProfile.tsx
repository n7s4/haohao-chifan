import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { NicknameSheet } from "../../components/community/NicknameSheet";
import { loadAvatar, mirrorPublicAvatar } from "../account";
import { getSupabase } from "../supabase";
import { useAuth } from "../useAuth";
import { ensurePublicProfile, getProfiles, renamePublicProfile, type FailReason, type Result } from "./api";

export type CommunityProfile = { nickname: string };

type Ctx = {
  profile: CommunityProfile | null;
  /** 有公开资料 → true；没有则弹昵称弹层：确认 true，取消 false；未登录直接 false（调用方去登录）。 */
  ensure: () => Promise<boolean>;
  rename: (nickname: string) => Promise<Result<void>>;
};

const CommunityProfileContext = createContext<Ctx>({
  profile: null,
  ensure: async () => false,
  rename: async () => ({ ok: false, reason: "auth" }),
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
  const userRef = useRef<string | null>(null);
  const profileRef = useRef<CommunityProfile | null>(null);
  const loadRef = useRef<Promise<void>>(Promise.resolve());
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

  // 每个登录用户只加载一次；登出 / 换账号时清空，并放弃还在等的 ensure()。
  useEffect(() => {
    userRef.current = userId;
    profileRef.current = null;
    // 放弃还在等的 ensure()；asking 由 userId 派生，不需要在这里 setState。
    pendingRef.current?.(false);
    pendingRef.current = null;
    if (!userId) {
      loadRef.current = Promise.resolve();
      return;
    }
    loadRef.current = getProfiles(getSupabase(), [userId])
      .then((r) => {
        if (userRef.current !== userId || !r.ok) return;
        const mine = r.value.get(userId);
        if (mine) apply(userId, { nickname: mine.nickname });
      })
      .catch(() => {});
  }, [userId, apply]);

  const ensure = useCallback(async () => {
    const uid = userRef.current;
    if (!uid) return false;
    await loadRef.current;
    if (userRef.current !== uid) return false;
    if (profileRef.current) return true;
    settle(false); // 同时只留一个弹层
    return new Promise<boolean>((resolve) => {
      pendingRef.current = resolve;
      setAskingFor(uid);
    });
  }, [settle]);

  const rename = useCallback(async (nickname: string): Promise<Result<void>> => {
    const uid = userRef.current;
    if (!uid) return { ok: false, reason: "auth" };
    const r = await renamePublicProfile(getSupabase(), uid, nickname);
    if (r.ok && userRef.current === uid) apply(uid, { nickname: nickname.trim() });
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

  const value = useMemo(() => ({ profile, ensure, rename }), [profile, ensure, rename]);

  return (
    <CommunityProfileContext.Provider value={value}>
      {children}
      {asking ? <NicknameSheet onConfirm={confirmNickname} onCancel={() => settle(false)} /> : null}
    </CommunityProfileContext.Provider>
  );
}
