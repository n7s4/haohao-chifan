import { AppState, Platform } from "react-native";

import { fetchSnapshot, hasRemoteData } from "./pull";
import { hasLocalData, markSeeded, seedFromLocal } from "./bootstrap";
import { mergeSnapshot, type LocalState } from "./merge";
import { flushOutbox, outboxPaused, pendingCount, pendingKeys, type FlushResult } from "./outbox";
import { hasPendingReconcile, runPendingReconcile } from "./reconcile";
import { getCurrentUserId, isSupabaseConfigured } from "../supabase";

export type SyncReport = {
  signedIn: boolean;
  seeded: number;
  pushed: number;
  failed: number;
  remaining: number;
  pulled: { plan: number; prefs: number; items: number; cookLog: number; recipes: number };
  error?: string;
  /** 队列被登录态 / RLS / schema 问题拦住，需要用户处理而不是继续重试 */
  pausedReason?: string;
};

let running: Promise<SyncReport> | null = null;

let flushTimer: ReturnType<typeof setTimeout> | null = null;

type FlushListener = (result: FlushResult) => void;
let flushListeners: FlushListener[] = [];

/**
 * 后台合并推送（scheduleFlush）不像 syncNow 那样有返回值，但界面上的
 * 「N 项待推送」必须跟着它变，否则用户改完一条这行会一直挂着旧数。
 */
export function subscribeFlush(listener: FlushListener) {
  flushListeners.push(listener);
  return () => {
    flushListeners = flushListeners.filter((item) => item !== listener);
  };
}

function notifyFlush(result: FlushResult) {
  for (const listener of flushListeners) listener(result);
}

/**
 * 写操作入队后调一次，把短时间内的连续改动合并成一次上传。
 * 没有这个的话，队列只会在回前台/联网时被 flush，用户停在页面上就一直是本地的。
 */
export function scheduleFlush(delayMs = 1500) {
  if (!isSupabaseConfigured) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushOutbox()
      .then(notifyFlush)
      .catch(() => {});
  }, delayMs);
}

/**
 * 一次完整同步：先把本地队列推上去，再拉最新快照合回本地。
 * 顺序不能反——先拉会把还没上传的本地改动冲掉。
 */
export function syncNow(apply: (state: LocalState) => void, local: LocalState): Promise<SyncReport> {
  if (running) return running;
  running = doSync(apply, local).finally(() => {
    running = null;
  });
  return running;
}

async function doSync(apply: (state: LocalState) => void, local: LocalState): Promise<SyncReport> {
  const empty: SyncReport = {
    signedIn: false,
    seeded: 0,
    pushed: 0,
    failed: 0,
    remaining: 0,
    pulled: { plan: 0, prefs: 0, items: 0, cookLog: 0, recipes: 0 },
  };
  if (!isSupabaseConfigured) return empty;

  const userId = await getCurrentUserId();
  if (!userId) return { ...empty, remaining: await pendingCount(userId) };

  let seeded = 0;
  let pushed = 0;
  let failed = 0;

  // 首次登录：云端还是空的，而本地已经用了一阵子，先把本地整份推上去再拉。
  // 反过来会拿空快照把用户攒的菜单整个盖掉。
  try {
    // 判据只用「云端是否为空」，不看本地 seeded 标记：标记写了但那次上传失败
    // （断网、队列被当数据错误丢弃）时，标记会让云端永远补不上。
    // 补种全是幂等 upsert，云端非空就不进来，重复执行也安全。
    const remote = await hasRemoteData();
    if (!remote && hasLocalData(local)) {
      seeded = await seedFromLocal(userId, local);
      await markSeeded(userId);
    }
  } catch (error) {
    return {
      ...empty,
      signedIn: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // 离线导入留下的补账：必须在 flush 和 pull 之前跑完，
  // 否则 pull 会先把该撤的行拉回本地。拿不到快照就保留标记、本轮不拉。
  let blockedByReconcile = false;
  try {
    if (await hasPendingReconcile(userId)) {
      blockedByReconcile = !(await runPendingReconcile(userId, local));
    }
  } catch {
    blockedByReconcile = true;
  }

  try {
    const flush = await flushOutbox();
    pushed = flush.pushed;
    failed = flush.failed;
  } catch (error) {
    return {
      ...empty,
      signedIn: true,
      failed: 1,
      remaining: await pendingCount(userId),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (blockedByReconcile) {
    // 只推不拉：把本地改动送上去，等下一次能拿到快照时再补清扫 + 合并。
    return {
      ...empty,
      signedIn: true,
      seeded,
      pushed,
      failed,
      remaining: await pendingCount(userId),
      pausedReason: outboxPaused()?.reason,
    };
  }

  try {
    const snapshot = await fetchSnapshot();
    // 只看当前账号的待推送键：别人的残留条目不该挡住本账号的合并。
    const pending = await pendingKeys(userId);
    const { state, stats } = mergeSnapshot(local, snapshot, userId, pending);
    apply(state);
    return {
      signedIn: true,
      seeded,
      pushed,
      failed,
      remaining: await pendingCount(userId),
      pulled: {
        plan: stats.plan,
        prefs: stats.prefs,
        items: stats.items,
        cookLog: stats.cookLog,
        recipes: stats.recipes,
      },
      pausedReason: outboxPaused()?.reason,
    };
  } catch (error) {
    return {
      ...empty,
      signedIn: true,
      seeded,
      pushed,
      failed,
      remaining: await pendingCount(userId),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 应用回到前台时补一次同步。移动端只在真的有未推送改动或超过 5 分钟时拉取，
 * 避免每次切后台切回来都打一轮请求。
 */
export function watchForeground(run: () => void, intervalMs = 5 * 60_000) {
  let last = 0;
  const tick = () => {
    if (Date.now() - last < intervalMs) return;
    last = Date.now();
    run();
  };
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.addEventListener("online", tick);
      return () => window.removeEventListener("online", tick);
    }
    return () => {};
  }
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") tick();
  });
  return () => sub.remove();
}
