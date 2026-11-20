import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getSupabase } from "../supabase";
import { useAuth } from "../useAuth";
import { listConversations } from "./messages";
import { totalUnread } from "./messagesLogic";

type Ctx = {
  /** 所有会话的未读总数。游客 / 还没加载完时是 0。 */
  total: number;
  refresh: () => void;
};

const UnreadContext = createContext<Ctx>({ total: 0, refresh: () => {} });

export const useUnread = () => useContext(UnreadContext);

/** 消息未读红点：登录用户变化、App 回到前台时拉一次会话列表求总数；消息页读完后也会手动 refresh。 */
export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  // 带着所属 userId，换账号时自然失效。
  const [owned, setOwned] = useState<{ userId: string; total: number } | null>(null);
  const total = owned && owned.userId === userId ? owned.total : 0;
  // 手动 refresh / 回到前台时递增，触发下面的 effect 重新拉取。
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    listConversations(getSupabase())
      .then((r) => {
        if (alive && r.ok) setOwned({ userId, total: totalUnread(r.value) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const value = useMemo(() => ({ total, refresh }), [total, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}
