import AsyncStorage from "@react-native-async-storage/async-storage";

import { getCurrentUserId, getSupabase, isSupabaseConfigured } from "../supabase";

/**
 * 离线写队列：本地改动先落 AsyncStorage，联网后按顺序重放。
 * 同一业务键的多条改动会合并成一条，避免离线连点把队列撑爆。
 *
 * 每条 entry 都带自己的 userId：同一台设备先后登过两个号时，A 的残留改动
 * 绝不能用 B 的 token 发出去。flush 只处理当前账号的条目，别人的原样留着。
 */

export type SyncTable =
  | "meal_plan_entries"
  | "shopping_items"
  | "recipe_prefs"
  | "cook_log"
  | "recipes"
  | "media_assets";

export type OutboxEntry = {
  /** `${table}:${naturalKey}`，用于合并同一业务对象的多次改动 */
  key: string;
  /** 这条改动属于哪个账号；换号后不会被别人的 token 重放 */
  userId: string;
  table: SyncTable;
  /** upsert 的冲突列，必须与库里的主键/唯一约束一致 */
  conflict: string;
  row: Record<string, unknown>;
  attempts: number;
  queuedAt: string;
  lastAttemptAt?: string;
  lastError?: string;
};

const OUTBOX_KEY = "haohao-chifan:outbox:v2";
const LEGACY_OUTBOX_KEY = "haohao-chifan:outbox:v1";
const MAX_ATTEMPTS = 8;

let cache: OutboxEntry[] | null = null;
let flushing: Promise<FlushResult> | null = null;
let writing: Promise<void> = Promise.resolve();
/** 遇到权限/登录态问题就停下队列，等重新登录后再继续，不丢用户改动。 */
let paused: { reason: string; at: string } | null = null;

export type FlushResult = {
  pushed: number;
  failed: number;
  remaining: number;
  /** 非空表示队列被拦住了，需要用户重新登录或修 schema */
  pausedReason?: string;
};

export function outboxPaused(): { reason: string; at: string } | null {
  return paused;
}

export function resumeOutbox(): void {
  paused = null;
}

async function load(): Promise<OutboxEntry[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    if (raw) {
      cache = JSON.parse(raw) as OutboxEntry[];
      return cache;
    }
    // v1 没有 userId 字段，从 row.user_id 补出来，避免升级后队列被当成别人的。
    const legacyRaw = await AsyncStorage.getItem(LEGACY_OUTBOX_KEY);
    if (!legacyRaw) {
      cache = [];
      return cache;
    }
    const legacy = JSON.parse(legacyRaw) as (Omit<OutboxEntry, "userId"> & { userId?: string })[];
    const migrated: OutboxEntry[] = legacy.map((entry) => ({
      ...entry,
      userId: entry.userId ?? String((entry.row as { user_id?: unknown }).user_id ?? ""),
    }));
    cache = migrated;
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(migrated));
    return cache;
  } catch {
    cache = [];
  }
  return cache;
}

function persist(entries: OutboxEntry[]) {
  cache = entries;
  const payload = JSON.stringify(entries);
  writing = writing.then(() => AsyncStorage.setItem(OUTBOX_KEY, payload)).catch(() => {});
  return writing;
}

export async function pendingCount(userId?: string | null): Promise<number> {
  const entries = await load();
  if (userId === undefined) return entries.length;
  return entries.filter((entry) => entry.userId === userId).length;
}

/** 只返回当前账号的待推送键：合并快照时不能拿别人的队列去挡本地。 */
export async function pendingKeys(userId?: string | null): Promise<Set<string>> {
  const entries = await load();
  return new Set(
    entries.filter((entry) => userId === undefined || entry.userId === userId).map((entry) => entry.key)
  );
}

/**
 * 入队。同一个业务键的多次改动合并成一条，保留原排队顺序。
 * row 是**按列合并**而不是整行替换：先勾选、再改数量，两条都在；
 * 换成整行替换的话后一条会把前一条的列抹掉，等于静默丢改动。
 */
export async function enqueue(
  entry: Omit<OutboxEntry, "attempts" | "queuedAt" | "userId"> & { userId?: string }
): Promise<void> {
  const userId = entry.userId ?? String((entry.row as { user_id?: unknown }).user_id ?? "");
  if (!userId) return; // 没有归属的写不能进队列，否则换号后会打到别人头上
  const entries = await load();
  const existing = entries.find((item) => item.key === entry.key && item.userId === userId);
  const nextPayload: OutboxEntry = {
    ...entry,
    userId,
    row: existing ? { ...existing.row, ...entry.row } : entry.row,
    attempts: 0,
    queuedAt: existing?.queuedAt ?? new Date().toISOString(),
  };
  const next = existing
    ? entries.map((item) => (item.key === entry.key && item.userId === userId ? nextPayload : item))
    : [...entries, nextPayload];
  await persist(next);
}

/** 退出登录时清掉该账号的待推送条目属于危险操作，这里只在测试/重置时用。 */
export async function clearOutbox(): Promise<void> {
  await persist([]);
}

function backoffMs(attempts: number) {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * 重放队列。失败条目保留并退避，网络类错误直接中断本轮（后面的多半也发不出去）。
 */
export function flushOutbox(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** 登录态失效 / RLS / schema 漂移：重放没用，先停住保住数据。 */
function isBlockingError(status: number, code: string | undefined): boolean {
  if (status === 401 || status === 403) return true;
  if (code === "42501") return true; // insufficient_privilege (RLS)
  if (code === "42P10") return true; // ON CONFLICT 找不到对应唯一约束
  if (code && code.startsWith("PGRST2")) return true; // schema cache 没刷到
  return false;
}

async function doFlush(): Promise<FlushResult> {
  const entries = [...(await load())];
  if (!isSupabaseConfigured) return { pushed: 0, failed: 0, remaining: entries.length };

  const userId = await getCurrentUserId();
  // 游客态不发请求，也不动队列；换号时这里会把别人的条目挡在外面。
  if (!userId) return { pushed: 0, failed: 0, remaining: entries.length };
  if (paused) {
    return { pushed: 0, failed: 0, remaining: entries.length, pausedReason: paused.reason };
  }

  const mine = entries.filter((entry) => entry.userId === userId);
  if (!mine.length) return { pushed: 0, failed: 0, remaining: entries.length };

  const supabase = getSupabase();
  const done = new Set<string>();
  // 纯数据问题（校验失败、外键不存在）重放多少次都一样，直接丢弃，避免队列永久卡住。
  const dropped = new Set<string>();
  const now = Date.now();
  let failed = 0;
  let pausedReason: string | undefined;

  for (const entry of mine) {
    if (entry.attempts >= MAX_ATTEMPTS) {
      failed += 1;
      continue;
    }
    if (entry.lastAttemptAt && now - Date.parse(entry.lastAttemptAt) < backoffMs(entry.attempts)) {
      failed += 1;
      continue;
    }

    const { error } = await supabase.from(entry.table).upsert(entry.row, {
      onConflict: entry.conflict,
    });

    if (!error) {
      done.add(entry.key);
      continue;
    }

    failed += 1;
    entry.attempts += 1;
    entry.lastAttemptAt = new Date().toISOString();
    entry.lastError = error.message;

    const status = (error as { status?: number }).status ?? 0;
    const code = (error as { code?: string }).code;

    if (isBlockingError(status, code)) {
      // 不丢、不涨重试次数：等用户重新登录或 schema 修好后再放行。
      entry.attempts -= 1;
      paused = { reason: error.message, at: new Date().toISOString() };
      pausedReason = error.message;
      break;
    }

    const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
    if (!retryable) dropped.add(entry.key);
  }

  const remaining = entries.filter(
    (entry) => !done.has(entry.key) && !dropped.has(entry.key)
  );
  await persist(remaining);
  return { pushed: done.size, failed, remaining: remaining.length, pausedReason };
}
