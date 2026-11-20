import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getSupabase } from "../supabase";
import { useAuth } from "../useAuth";
import type { Result } from "./api";
import { block as blockApi, myBlocks, unblock as unblockApi } from "./social";

type Ctx = {
  /** 我拉黑的人。游客 / 还没加载完时是空集合。 */
  blocked: ReadonlySet<string>;
  block: (id: string) => Promise<Result<void>>;
  unblock: (id: string) => Promise<Result<void>>;
  refresh: () => Promise<void>;
};

const EMPTY: ReadonlySet<string> = new Set();

const BlocksContext = createContext<Ctx>({
  blocked: EMPTY,
  block: async () => ({ ok: false, reason: "auth" }),
  unblock: async () => ({ ok: false, reason: "auth" }),
  refresh: async () => {},
});

export const useBlocks = () => useContext(BlocksContext);

/** 黑名单：登录用户变化时重新拉取；拉黑 / 解除成功后本地立即更新。 */
export function BlocksProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  // 带着所属 userId，换账号时自然失效。
  const [owned, setOwned] = useState<{ userId: string; ids: ReadonlySet<string> } | null>(null);
  const blocked = owned && owned.userId === userId ? owned.ids : EMPTY;

  const refresh = useCallback(async () => {
    if (!userId) return;
    const r = await myBlocks(getSupabase(), userId).catch(() => null);
    if (r?.ok) setOwned({ userId, ids: new Set(r.value) });
  }, [userId]);

  // 登录用户变化时重新拉取；换号后旧请求的结果丢掉。
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    myBlocks(getSupabase(), userId)
      .then((r) => {
        if (alive && r.ok) setOwned({ userId, ids: new Set(r.value) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const block = useCallback(async (id: string): Promise<Result<void>> => {
    if (!userId) return { ok: false, reason: "auth" };
    const r = await blockApi(getSupabase(), userId, id).catch(() => ({ ok: false, reason: "network" }) as const);
    if (r.ok) setOwned((prev) => ({ userId, ids: new Set([...(prev?.userId === userId ? prev.ids : []), id]) }));
    return r;
  }, [userId]);

  const unblock = useCallback(async (id: string): Promise<Result<void>> => {
    if (!userId) return { ok: false, reason: "auth" };
    const r = await unblockApi(getSupabase(), userId, id).catch(() => ({ ok: false, reason: "network" }) as const);
    if (r.ok) {
      setOwned((prev) => {
        const next = new Set(prev?.userId === userId ? prev.ids : []);
        next.delete(id);
        return { userId, ids: next };
      });
    }
    return r;
  }, [userId]);

  const value = useMemo(() => ({ blocked, block, unblock, refresh }), [blocked, block, unblock, refresh]);
  return <BlocksContext.Provider value={value}>{children}</BlocksContext.Provider>;
}
