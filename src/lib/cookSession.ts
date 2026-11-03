import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "haohao-chifan:cook-session:v1";
/** 闲置超过 8 小时的会话直接丢弃，不再打扰。 */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type CookSession = {
  recipeId: string;
  recipeName: string;
  step: number;
  /** 暂停时剩余秒数 */
  remaining: number;
  /** 计时中时的结束时间戳；暂停时为 null */
  deadlineAt: number | null;
  elapsedTotal: number;
  savedAt: number;
};

export async function saveCookSession(session: CookSession) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // 存不下就不存，不影响烹饪。
  }
}

/** 任意菜谱的未完成会话，用于首页的「继续上次烹饪」入口。 */
export async function loadAnyCookSession(): Promise<CookSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookSession;
    if (!parsed?.recipeId) return null;
    if (Date.now() - parsed.savedAt > SESSION_TTL_MS) {
      await clearCookSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function loadCookSession(recipeId: string): Promise<CookSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookSession;
    if (!parsed || parsed.recipeId !== recipeId) return null;
    if (Date.now() - parsed.savedAt > SESSION_TTL_MS) {
      await clearCookSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearCookSession() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
