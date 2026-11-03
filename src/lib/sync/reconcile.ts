import AsyncStorage from "@react-native-async-storage/async-storage";

import type { LocalState } from "./merge";
import { fetchSnapshot } from "./pull";
import { queueRemoteSweep } from "./replaceAll";

/**
 * 「导入时没拿到云端快照」的补账。
 *
 * 离线导入只能按本机 blob 算差量，云端那些本机没有的行一条 tombstone 都收不到；
 * 恢复网络后 pull 会把它们原样拉回来，用户看到的是「导入完过一会儿又变回去」。
 * 所以拉取失败时落一个标记，下次 syncNow 在 **flush 之前** 补跑一次云端清扫。
 *
 * 顺序必须是 reconcile → flush → pull：pull 先跑就会先把这些行拉回本地，
 * 再撤就得等下一轮，中间那段时间用户看到的东西是错的。
 */

const PENDING_PREFIX = "haohao-chifan:reconcile:";

export type ReconcileTarget = LocalState;

/** 标记只存 userId，目标状态用当前内存里的（导入后用户可能又改了几笔，取最新的更准）。 */
export async function markPendingReconcile(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_PREFIX + userId, new Date().toISOString());
  } catch {
    // 写失败最多让云端多留几行旧数据，等用户下次完整同步时 pull 会照常合并。
  }
}

export async function hasPendingReconcile(userId: string): Promise<boolean> {
  try {
    return Boolean(await AsyncStorage.getItem(PENDING_PREFIX + userId));
  } catch {
    return false;
  }
}

export async function clearPendingReconcile(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_PREFIX + userId);
  } catch {
    // 忽略：残留标记只会让下一轮多做一次幂等清扫。
  }
}

/**
 * 补跑云端清扫。拿不到快照就保留标记，下次同步再试——绝不能当成成功。
 * @returns 是否真的跑完了（true 才清标记）
 */
export async function runPendingReconcile(userId: string, target: ReconcileTarget): Promise<boolean> {
  if (!(await hasPendingReconcile(userId))) return false;
  let remote;
  try {
    remote = await fetchSnapshot();
  } catch {
    return false;
  }
  await queueRemoteSweep(userId, target, remote);
  await clearPendingReconcile(userId);
  return true;
}
