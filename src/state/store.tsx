import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MealSlot, Recipe, cookingIngredients, mealSlots, recipes } from "../data/recipes";
import { getCurrentUserId, getSupabase, isSupabaseConfigured } from "../lib/supabase";
import { scheduleFlush, subscribeFlush, syncNow, watchForeground } from "../lib/sync/engine";
import { fetchSnapshot } from "../lib/sync/pull";
import { markPendingReconcile } from "../lib/sync/reconcile";
import { resumeOutbox } from "../lib/sync/outbox";
import type { LocalState } from "../lib/sync/merge";
import { hasContent, mergeGuestIntoAccount } from "../lib/sync/guestMerge";
import { persistableImage, persistableSteps, type RecipeStep, type StepImage } from "../lib/steps";
import { adoptLocalMedia, cachedMediaFile, removeRecipeMedia, uploadMedia } from "../lib/media";
import { seedFromLocal } from "../lib/sync/bootstrap";
import { planPool } from "../lib/community/logic";
import { queueReplaceAll } from "../lib/sync/replaceAll";
import {
  queueCookLog,
  queueDerivedItem,
  queueManualItem,
  queuePlanSlot,
  queuePrefs,
  queueRecipe,
} from "../lib/sync/mutations";

export type DayPlan = Partial<Record<MealSlot, string>>;
export type PlanMap = Record<string, DayPlan>;

export type CustomRecipeInput = {
  name: string;
  minutes?: number | null;
  ingredients: { name: string; qty: number | null; unit: string }[];
  /** 调料：存进同一份 ingredients，带 section 标记，单独一区展示、不进采购清单。 */
  seasonings?: { name: string; qty: number | null; unit: string }[];
  steps: RecipeStep[];
  /** 成品图（封面）。选完图先带 localUri，保存时由 store 搬进缓存目录。 */
  cover?: StepImage | null;
  // 以下可选：「存到我的菜谱」整道复制社区菜时才传；不传就和以前一样（新建取默认值、编辑保留原值）。
  subtitle?: string;
  description?: string;
  tags?: string[];
  difficulty?: string;
  calories?: number;
  heat?: string;
  tips?: string[];
  stepMinutes?: number[];
  art?: Recipe["art"];
  origin?: Recipe["origin"];
};

const OPTIONAL_INPUT_KEYS = [
  "subtitle",
  "description",
  "tags",
  "difficulty",
  "calories",
  "heat",
  "tips",
  "stepMinutes",
  "art",
  "origin",
] as const;

/** 主料 + 调料合并进同一份 ingredients，调料打 section 标记。名称空的整行丢掉。 */
function normalizeCustomInput(input: CustomRecipeInput) {
  const clean = (item: { name: string; qty: number | null; unit: string }, section?: "seasoning") => ({
    name: item.name.trim(),
    qty: item.qty,
    unit: item.unit.trim(),
    ...(section ? { section } : {}),
  });
  const ingredients = [
    ...input.ingredients.filter((item) => item.name.trim()).map((item) => clean(item)),
    ...(input.seasonings ?? []).filter((item) => item.name.trim()).map((item) => clean(item, "seasoning")),
  ];
  const typedSteps = input.steps
    .filter((step) => step.text.trim().length > 0)
    .map((step) => ({
      text: step.text.trim(),
      ...(step.images?.length ? { images: step.images } : {}),
    }));
  // 烹饪页按步骤推进，空数组会渲染成一片空白；不填就给一步兜底。
  const steps: RecipeStep[] = typedSteps.length
    ? typedSteps
    : [{ text: "按自己的做法把这道菜做完。" }];
  const name = input.name.trim();
  if (!name || !ingredients.length) return null;
  const cover = input.cover?.id ? input.cover : undefined;
  // 只带调用方真给了的可选字段：没给的 key 不出现，编辑时 {...current, ...normalized} 才不会把原值抹成 undefined。
  const extras: Partial<Pick<Recipe, (typeof OPTIONAL_INPUT_KEYS)[number]>> = {};
  for (const key of OPTIONAL_INPUT_KEYS) {
    if (input[key] !== undefined) (extras as Record<string, unknown>)[key] = input[key];
  }
  return { ...extras, name, ingredients, steps, minutes: input.minutes ?? 0, cover };
}

export type ShoppingItem = {
  id: string;
  name: string;
  qty: number | null;
  unit: string;
  checked: boolean;
  sources: string[];
};

export type ManualItem = {
  id: string;
  name: string;
  qty: number | null;
  unit: string;
  checked: boolean;
  /** 该条只在指定周显示；缺省表示历史数据，任何周都显示 */
  weekKey?: string;
  /** 来源菜名；从上周顺延过来的条目沿用它，缺省表示手动添加 */
  sources?: string[];
};

type PersistedState = {
  plan: PlanMap;
  favorites: string[];
  checked: Record<string, boolean>;
  qtyOverrides: Record<string, number>;
  /** 用户从清单里移除的派生食材，key 是 `${weekKey}::${itemId}`。派生项是现算的，只能记「排除」而不是删数据。 */
  removed?: Record<string, boolean>;
  manualItems: ManualItem[];
  ratings: Record<string, number>;
  servings: Record<string, number>;
  cookedLog: { date: string; recipeId: string }[];
  /** 用户自建菜谱；内置菜是常量，不落这里也不入库。 */
  customRecipes?: Recipe[];
  carryQty?: Record<string, number>;
  /** 本周已顺延到下周的食材 id，避免同一项被重复带到下周 */
  carried?: Record<string, string[]>;
  lastExportAt?: string;
};

export type BackupPayload = PersistedState;

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`;

/** 自建菜 id。「存到我的菜谱」要先定 id 才能算私有桶路径，所以单独导出。 */
export const newCustomRecipeId = () => uid("custom");

export const toKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const parseKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const startOfWeek = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return copy;
};

export const addDays = (date: Date, days: number) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

/** 首启不预排任何菜：新用户的这一周应该是空的。 */
const emptyPlan = (): PlanMap => ({});

type Store = {
  ready: boolean;
  plan: PlanMap;
  favorites: string[];
  selectedDate: string;
  setSelectedDate: (key: string) => void;
  setMeal: (dateKey: string, slot: MealSlot, recipeId: string | null) => void;
  clearDay: (dateKey: string) => void;
  applyPlan: (next: PlanMap) => void;
  planThreeDays: (anchorKey?: string) => number;
  toggleFavorite: (recipeId: string) => void;
  ratings: Record<string, number>;
  rateRecipe: (recipeId: string, stars: number) => void;
  /** 内置菜 + 自建菜的合并源：所有「按 id 找菜」的地方都读它。 */
  allRecipes: Recipe[];
  /** 自建菜（不含内置），新建/同步用。 */
  customRecipes: Recipe[];
  /** 读最新的自建菜（不等重渲染）：异步流程里查重用它，闭包里的 customRecipes 可能是旧的。 */
  getCustomRecipes: () => Recipe[];
  /** 按 id 找菜（内置 + 自建）。找不到返回 undefined。 */
  findRecipe: (id: string | null | undefined) => Recipe | undefined;
  /** 某个餐位上排的菜；优先走合并源，自建菜也能取到。 */
  recipeFor: (plan: DayPlan, slot: MealSlot) => Recipe | undefined;
  /** id 不传就新生成；传了必须来自 newCustomRecipeId()。 */
  createRecipe: (input: CustomRecipeInput, id?: string) => Recipe | null;
  /** 只能改自建菜；内置/他人菜谱一律返回 null，UI 也不给入口。 */
  updateRecipe: (id: string, input: CustomRecipeInput) => Recipe | null;
  /** 只删自建菜：内置菜和别人的菜不在 customRecipes 里，返回 false。 */
  deleteRecipe: (id: string) => boolean;
  shoppingItems: ShoppingItem[];
  trippedCount: number;
  toggleChecked: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  addManualItem: (name: string, qty: number | null, unit: string) => void;
  removeManualItem: (id: string) => void;
  /** 移除任意一项（派生项=本周排除，手动项=删除），两种情况都会同步到云端 */
  removeItem: (id: string) => void;
  /** 本周被移除的派生食材，供「已移除 · 恢复」使用 */
  removedItems: { id: string; name: string }[];
  restoreRemoved: (id: string) => void;
  resetChecked: () => void;
  weekKey: string;
  weekDays: string[];
  shiftWeek: (delta: number) => void;
  servings: Record<string, number>;
  setServings: (recipeId: string, value: number) => void;
  cookedLog: { date: string; recipeId: string }[];
  logCooked: (recipeId: string) => void;
  cookedThisWeek: number;
  carryPending: () => { moved: number; merged: number };
  undoCarry: () => void;
  carriedCount: number;
  exportBackup: () => string;
  /** 把「未并入的游客那份」单独导出：内存里此刻是账号数据，不能拿它冒充游客备份。 */
  exportGuestBackup: () => string | null;
  importBackup: (raw: string) => Promise<{
    ok: boolean;
    error?: string;
    source?: "guest" | "account";
    /** 导入时没拿到云端快照，只按本机差量入队；已落补账标记，下次同步会补撤云端旧行。 */
    degraded?: boolean;
    /** 被替换掉的本地内容计数，用于确认文案 */
    replaced?: { plan: number; favorites: number };
  }>;
  lastExportAt: string | null;
  markExported: () => void;
  /** 队列被登录态 / RLS / schema 问题拦住时的提示文案；null 表示正常 */
  syncPaused: string | null;
  /** 最近一次同步的落点；未登录或还没跑过为 null */
  lastSyncedAt: number | null;
  /** 本周排上了、但菜谱源里查不到的菜数：这些菜的食材算不进采购清单 */
  missingRecipeCount: number;
  /** 队列里还没推上去的条数，用来区分「已同步」和「N 项待推送」 */
  pendingCount: number;
  /** 手动触发一次完整同步（先推后排），「我的」页点待推送那行用 */
  syncNow: () => void;
  /** 正在跑一轮完整同步，按钮文案用 */
  syncing: boolean;
  /** 登录时发现本机有未并入的游客改动，等用户选一次 */
  guestMerge: { planCount: number; favoriteCount: number; manualCount: number } | null;
  resolveGuestMerge: (merge: boolean) => void;
  /** 「我的」页点「合并本机数据」：把游客快照重新弹出来 */
  reopenGuestMerge: () => Promise<void>;
  /** 用户选了「先不并」：游客那份仍只在本机，需要在「我的」页常驻提示 */
  guestLocalOnly: boolean;
};

const StoreContext = createContext<Store | null>(null);

/** 旧版勾选 / 数量是裸食材 id，补当前周前缀，避免历史状态串到别的周。 */
function withWeekPrefix<T>(map: Record<string, T>): Record<string, T> {
  const week = toKey(startOfWeek(new Date()));
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key.includes("::") ? key : `${week}::${key}`] = value;
  }
  return out;
}

/**
 * 本地 blob 必须按账号分文件：同一台设备换号时，A 的菜单绝不能被当成
 * 「本地已有数据」种进 B 的云端（RLS 拦不住，因为写的是 B 的身份）。
 * 游客单独一份 `:guest`，登录/登出只切 key，不覆盖。
 */
const LEGACY_STORAGE_KEY = "haohao-chifan:state:v1";
const guestKey = "haohao-chifan:state:v2:guest";
const storageKeyFor = (userId: string | null) => (userId ? `haohao-chifan:state:v2:${userId}` : guestKey);
/**
 * 游客数据只允许被「第一个登录的账号」认领一次。
 * 没有这个标记的话：A 登录后 B 再登录（云端为空）会把 A 的游客残留种进 B 的账号。
 */
const CLAIM_KEY = "haohao-chifan:state:v2:claimed-by";
const MIGRATED_KEY = "haohao-chifan:state:v2:migrated-from-v1";
/**
 * 游客键里有没有「账号不知道的改动」。有的话登出时绝不能用账号副本盖掉它，
 * 否则用户下午在游客态改的菜单会在下一次登出时永久消失。
 */
const GUEST_DIRTY_KEY = "haohao-chifan:state:v2:guest-dirty";
/** 每个账号只就「游客改动要不要并入」问一次，问完记下，之后不再打扰。 */
/**
 * 记录「这份游客内容已经被问过了」的指纹，而不是一个布尔标记。
 * 用布尔的话用户选完「先不并」再在游客态改东西，登录时就不会再问，
 * 那批新改动同样会静默消失——只是从「不问」换了个位置。
 */
const guestPromptKey = (userId: string) => `haohao-chifan:state:v2:guest-prompted:${userId}`;

function fingerprint(raw: string | null | undefined) {
  if (!raw) return "";
  let h = 5381;
  for (let i = 0; i < raw.length; i += 1) h = (Math.imul(h, 33) ^ raw.charCodeAt(i)) >>> 0;
  return `${raw.length}:${h.toString(36)}`;
}

/**
 * 只保留会写进 blob 的字段，并固定顺序：用来判断游客键「是否真的被用户改过」，
 * 避免因为 JSON 字段顺序不同把镜像误判成用户编辑。
 */
function payloadOf(parsed: Partial<PersistedState> | null, lastExportAt?: string | null) {
  return {
    plan: parsed?.plan ?? {},
    favorites: parsed?.favorites ?? [],
    checked: parsed?.checked ?? {},
    qtyOverrides: parsed?.qtyOverrides ?? {},
    removed: parsed?.removed ?? {},
    manualItems: parsed?.manualItems ?? [],
    ratings: parsed?.ratings ?? {},
    servings: parsed?.servings ?? {},
    cookedLog: parsed?.cookedLog ?? [],
    customRecipes: parsed?.customRecipes ?? [],
    carryQty: parsed?.carryQty ?? {},
    carried: parsed?.carried ?? {},
    lastExportAt: lastExportAt ?? parsed?.lastExportAt,
  };
}

/** 两个 local blob 是否有差异：用于给游客键打「用户改过」标记。 */
function samePayload(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState<PlanMap>(() => emptyPlan());
  const [favorites, setFavorites] = useState<string[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [manualItems, setManualItems] = useState<ManualItem[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [servings, setServingsMap] = useState<Record<string, number>>({});
  const [cookedLog, setCookedLog] = useState<{ date: string; recipeId: string }[]>([]);
  const [customRecipes, setCustomRecipes] = useState<Recipe[]>([]);
  const [carryQty, setCarryQty] = useState<Record<string, number>>({});
  const [carried, setCarried] = useState<Record<string, string[]>>({});
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  const lastExportAtRef = useRef<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => toKey(new Date()));
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()));
  const hydrated = useRef(false);
  /** 已登录用户的 id；游客态为 null，所有云端写入直接跳过。 */
  const userIdRef = useRef<string | null>(null);
  const servingsRef = useRef<Record<string, number>>({});
  const checkedRef = useRef<Record<string, boolean>>({});
  const removedRef = useRef<Record<string, boolean>>({});
  const manualItemsRef = useRef<ManualItem[]>([]);
  const planRef = useRef<PlanMap>({});
  const favoritesRef = useRef<string[]>([]);
  const ratingsRef = useRef<Record<string, number>>({});
  const qtyOverridesRef = useRef<Record<string, number>>({});
  const cookedLogRef = useRef<{ date: string; recipeId: string }[]>([]);
  const customRecipesRef = useRef<Recipe[]>([]);
  /** 补传图片要等下文的 pushRecipe 定义，这里用 ref 接住，避免声明顺序打架。 */
  const flushMediaRef = useRef<
    ((userId: string, options?: { recipeId?: string; budget?: number }) => Promise<void>) | null
  >(null);
  /** 本地写计数：同步返回时如果变了，说明用户已经又改了，丢弃这次合并结果。 */
  const mutationCount = useRef(0);
  /** 云端队列只做「尽力而为」：写失败不影响本地交互，下次联网再补。 */
  const pushRemote = useCallback((fn: (userId: string) => Promise<void>) => {
    mutationCount.current += 1;
    const userId = userIdRef.current;
    if (!userId) return;
    fn(userId)
      .then(() => scheduleFlush())
      .catch(() => {});
  }, []);

  const carryUndoRef = useRef<{
    weekKey: string;
    carryQty: Record<string, number>;
    manualItems: ManualItem[];
    carried: Record<string, string[]>;
  } | null>(null);

  /** 账号切换 / 首次探登录态都会让它 +1，触发下面的同步 effect。 */
  const [sessionVersion, setSessionVersion] = useState(0);
  const [syncPaused, setSyncPaused] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  /** 让「我的」页那行能触发完整同步；具体实现挂在下面那个 effect 里。 */
  const manualSyncRef = useRef<() => void>(() => {});
  /** 当前内存里这份状态属于哪个 key；保存时只写它，切号窗口内不串。 */
  const ownerKeyRef = useRef<string>("");
  const switchingRef = useRef(false);
  /** 游客键里当前内容的快照：只有真被改动过才置脏，避免登出镜像被误判成用户编辑。 */
  const guestBaselineRef = useRef<string | null>(null);
  const pendingGuestRef = useRef<{
    userId: string;
    guest: Partial<PersistedState>;
    account: Partial<PersistedState>;
    /** 卡片弹出那一刻的游客原串：记指纹用它，避免期间 pull 回来把指纹挪走。 */
    guestRaw: string;
  } | null>(null);
  const [guestMerge, setGuestMerge] = useState<Store["guestMerge"]>(null);
  const [guestLocalOnly, setGuestLocalOnly] = useState(false);

  /** 把某个 key 的内容铺进内存。没有内容就清空，绝不能保留上一个账号的数据。 */
  const loadAccount = useCallback(async (userId: string | null) => {
    const key = storageKeyFor(userId);
    if (key === ownerKeyRef.current) {
      userIdRef.current = userId;
      return;
    }
    switchingRef.current = true;
    let parsed: Partial<PersistedState> | null = null;
    try {
      // 退出登录：把这个账号当前的状态镜像到游客键上，界面上看到的东西不跳变。
      // 但如果游客键里有用户自己改过、账号不知道的内容，绝不能覆盖——那是用户
      // 在登出状态下真实写下的东西，盖掉就是「我下午改的怎么没了」。
      if (!userId && ownerKeyRef.current.startsWith("haohao-chifan:state:v2:") && ownerKeyRef.current !== guestKey) {
        const guestDirty = (await AsyncStorage.getItem(GUEST_DIRTY_KEY)) === "1";
        // 游客槽位只要已经有内容就一律不覆盖：有可能是用户登出后亲手改的，
        // 也可能是历史数据。删掉用户看得见的东西，比退出后界面换个样子严重得多。
        const guestRaw = await AsyncStorage.getItem(guestKey);
        const guestHasContent = guestRaw ? hasContent(JSON.parse(guestRaw) as Partial<PersistedState>) : false;
        if (!guestDirty && !guestHasContent) {
          const mine = await AsyncStorage.getItem(ownerKeyRef.current);
          if (mine) await AsyncStorage.setItem(guestKey, mine);
        }
      }
      let raw = await AsyncStorage.getItem(key);
      // 升级到按账号分文件：第一次运行且还没有任何 v2 数据时，把旧版 v1 整份搬成游客数据。
      // 只搬一次（标记随后写入），否则旧数据会在每次开 App 时被重新复活。
      if (!raw && !userId) {
        const migrated = await AsyncStorage.getItem(MIGRATED_KEY);
        if (!migrated) {
          const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacy) {
            await AsyncStorage.setItem(guestKey, legacy);
            raw = legacy;
          }
          await AsyncStorage.setItem(MIGRATED_KEY, "1");
        }
      }
      let justClaimed = false;
      if (!raw && userId) {
        // 这个账号在本机还没有自己的 blob：把游客/旧版数据接过来一次，
        // 也就是「登录后本地菜单自动变成这个账号的」。认领后打标记，第二个账号拿不到。
        const claimedBy = await AsyncStorage.getItem(CLAIM_KEY);
        if (!claimedBy) {
          const inherited =
            (await AsyncStorage.getItem(guestKey)) ?? (await AsyncStorage.getItem(LEGACY_STORAGE_KEY));
          if (inherited) {
            await AsyncStorage.setItem(key, inherited);
            await AsyncStorage.setItem(CLAIM_KEY, userId);
            // 认领就是整份复制，游客和账号此刻内容一致，不算「未并入的改动」。
            await AsyncStorage.removeItem(GUEST_DIRTY_KEY);
            raw = inherited;
            justClaimed = true;
          } else {
            await AsyncStorage.setItem(CLAIM_KEY, userId);
          }
        }
      }
      parsed = raw ? (JSON.parse(raw) as Partial<PersistedState>) : null;

      // 登录时本机还留着一份「账号不知道的游客改动」：不静默丢，也不偷偷并，
      // 问用户一次（每个账号只问一次），并/不并都由用户决定。
      // 注意：账号在本机还没有 blob（raw 为空、parsed 为 null）时同样要问一次——
      // CLAIM_KEY 已被别的账号占用时不会认领，游客改动就会静默看不见。
      setGuestLocalOnly(false);
      if (userId && !justClaimed) {
        const guestDirty = (await AsyncStorage.getItem(GUEST_DIRTY_KEY)) === "1";
        const prompted = await AsyncStorage.getItem(guestPromptKey(userId));
        const guestRaw = guestDirty ? await AsyncStorage.getItem(guestKey) : null;
        if (guestRaw) {
          const guest = JSON.parse(guestRaw) as Partial<PersistedState>;
          // 之前已经问过、用户选了「先不并」：这份游客数据只留在本机，提醒常驻。
          if (hasContent(guest) && prompted === fingerprint(guestRaw)) setGuestLocalOnly(true);
          if (hasContent(guest) && prompted !== fingerprint(guestRaw)) {
            pendingGuestRef.current = { userId, guest, account: parsed ?? {}, guestRaw };
            setGuestMerge({
              planCount: Object.values(guest.plan ?? {}).reduce(
                (total, day) => total + Object.keys(day ?? {}).length,
                0
              ),
              favoriteCount: guest.favorites?.length ?? 0,
              manualCount: guest.manualItems?.length ?? 0,
            });
          }
        }
      }
    } catch {
      parsed = null;
    }

    const nextPlan = parsed?.plan ?? emptyPlan();
    const nextFavorites = parsed?.favorites ?? [];
    const nextChecked = parsed?.checked ? withWeekPrefix(parsed.checked) : {};
    const nextQty = parsed?.qtyOverrides ? withWeekPrefix(parsed.qtyOverrides) : {};
    const nextRemoved = parsed?.removed ?? {};
    const nextManual = parsed?.manualItems ?? [];
    const nextRatings = parsed?.ratings ?? {};
    const nextServings = parsed?.servings ?? {};
    const nextCooked = parsed?.cookedLog ?? [];
    const nextCustom = parsed?.customRecipes ?? [];
    const nextCarryQty = parsed?.carryQty ?? {};
    const nextCarried = parsed?.carried ?? {};

    planRef.current = nextPlan;
    favoritesRef.current = nextFavorites;
    checkedRef.current = nextChecked;
    qtyOverridesRef.current = nextQty;
    removedRef.current = nextRemoved;
    manualItemsRef.current = nextManual;
    ratingsRef.current = nextRatings;
    servingsRef.current = nextServings;
    cookedLogRef.current = nextCooked;
    customRecipesRef.current = nextCustom;

    setPlan(nextPlan);
    setFavorites(nextFavorites);
    setChecked(nextChecked);
    setQtyOverrides(nextQty);
    setRemoved(nextRemoved);
    setManualItems(nextManual);
    setRatings(nextRatings);
    setServingsMap(nextServings);
    setCookedLog(nextCooked);
    setCustomRecipes(nextCustom);
    setCarryQty(nextCarryQty);
    setCarried(nextCarried);
    setLastExportAt(parsed?.lastExportAt ?? null);
    lastExportAtRef.current = parsed?.lastExportAt ?? null;

    ownerKeyRef.current = key;
    userIdRef.current = userId;
    // 换号 / 登出时同步状态属于上一个账号，留着会让新账号误显示「已同步 · 刚刚」。
    setLastSyncedAt(null);
    setPendingCount(0);
    guestBaselineRef.current = key === guestKey ? JSON.stringify(payloadOf(parsed)) : null;
    switchingRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 先问清登录态再决定读哪份 blob，避免游客键和账号键互相当成对方的数据。
      const userId = await getCurrentUserId().catch(() => null);
      if (cancelled) return;
      await loadAccount(userId);
      if (cancelled) return;
      hydrated.current = true;
      setReady(true);
      setSessionVersion((value) => value + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAccount]);

  // 上面几个 ref 只用于「读当前已提交的值」，避免在 setState 的 updater 里做副作用。
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);
  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);
  useEffect(() => {
    servingsRef.current = servings;
  }, [servings]);
  useEffect(() => {
    checkedRef.current = checked;
  }, [checked]);
  useEffect(() => {
    manualItemsRef.current = manualItems;
  }, [manualItems]);
  useEffect(() => {
    ratingsRef.current = ratings;
  }, [ratings]);
  useEffect(() => {
    qtyOverridesRef.current = qtyOverrides;
  }, [qtyOverrides]);
  useEffect(() => {
    removedRef.current = removed;
  }, [removed]);
  useEffect(() => {
    cookedLogRef.current = cookedLog;
  }, [cookedLog]);
  useEffect(() => {
    customRecipesRef.current = customRecipes;
  }, [customRecipes]);

  useEffect(() => {
    if (!hydrated.current || switchingRef.current) return;
    const key = ownerKeyRef.current;
    if (!key) return;
    const payload: PersistedState = {
      plan,
      favorites,
      checked,
      qtyOverrides,
      removed,
      manualItems,
      ratings,
      servings,
      cookedLog,
      customRecipes,
      carryQty,
      carried,
      lastExportAt: lastExportAt ?? undefined,
    };
    const serialized = JSON.stringify(payload);
    AsyncStorage.setItem(key, serialized).catch(() => {});
    // 游客键被用户真实改动过 → 打脏标记，之后登出时不要用账号副本把它盖掉。
    if (key === guestKey && guestBaselineRef.current !== null && !samePayload(serialized, guestBaselineRef.current)) {
      AsyncStorage.setItem(GUEST_DIRTY_KEY, "1").catch(() => {});
    }
  }, [plan, favorites, checked, qtyOverrides, removed, manualItems, ratings, servings, cookedLog, customRecipes, carryQty, carried, lastExportAt]);

  // ------------------------------------------------------------ 云端同步
  // 订阅 auth 变化：登录/退出时不是简单换个 userId，而是要整份切 blob。
  // 否则 A 退出、B 登录后，B 会把 A 的本地数据当成「自己的」种进云端。
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const id = session?.user.id ?? null;
      // token 续期成功说明之前的 401 已经好了，解除队列暂停并把改动补推上去。
      if (event === "TOKEN_REFRESHED" && id) {
        resumeOutbox();
        scheduleFlush(0);
        return;
      }
      if (userIdRef.current === id) return;
      loadAccount(id)
        .then(() => {
          if (cancelled) return;
          // 换号后队列里可能还躺着上一个账号的条目，先把暂停解除再试一次。
          resumeOutbox();
          setSessionVersion((value) => value + 1);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [loadAccount]);

  const localSnapshot = useCallback(
    (): LocalState => ({
      plan: planRef.current,
      favorites: favoritesRef.current,
      ratings: ratingsRef.current,
      servings: servingsRef.current,
      checked: checkedRef.current,
      qtyOverrides: qtyOverridesRef.current,
      removed: removedRef.current,
      manualItems: manualItemsRef.current,
      cookedLog: cookedLogRef.current,
      customRecipes: customRecipesRef.current,
    }),
    []
  );

  const applyRemote = useCallback((next: LocalState) => {
    // plan 里的空日要删掉，否则合并会留下 `{date: {}}` 这种空壳。
    const plan: PlanMap = {};
    Object.entries(next.plan).forEach(([key, day]) => {
      if (Object.keys(day).length) plan[key] = day;
    });
    planRef.current = plan;
    favoritesRef.current = next.favorites;
    ratingsRef.current = next.ratings;
    servingsRef.current = next.servings;
    checkedRef.current = next.checked;
    qtyOverridesRef.current = next.qtyOverrides;
    removedRef.current = next.removed ?? {};
    manualItemsRef.current = next.manualItems;
    cookedLogRef.current = next.cookedLog;
    // 云端没有这一项（老快照 / 未迁移）时保留本地，别把刚建的菜清空。
    if (next.customRecipes) customRecipesRef.current = next.customRecipes;
    setPlan(plan);
    setFavorites(next.favorites);
    setRatings(next.ratings);
    setServingsMap(next.servings);
    setChecked(next.checked);
    setQtyOverrides(next.qtyOverrides);
    setRemoved(next.removed ?? {});
    setManualItems(next.manualItems);
    setCookedLog(next.cookedLog);
    if (next.customRecipes) setCustomRecipes(next.customRecipes);
  }, []);

  // 后台合并推送（写操作后 1.5 秒那次）也会改队列长度，得把结果回写到界面状态，
  // 否则用户改完一条，「N 项待推送」会一直挂着旧数字直到下次完整同步。
  useEffect(() => {
    if (!ready) return;
    return subscribeFlush((result) => {
      setSyncPaused(result.pausedReason ?? null);
      setPendingCount(result.remaining);
      if (!result.pausedReason && result.failed === 0 && result.remaining === 0) {
        setLastSyncedAt(Date.now());
      }
    });
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      setSyncing(true);
      // 先把本地有文件、云端没 path 的图补传完再抓快照：顺序反了会把空 path 推上去。
      void (async () => {
        try {
          const userId = await getCurrentUserId();
          if (userId) await flushMediaRef.current?.(userId);
        } catch {
          // 补传失败不影响这一轮同步，图和 path 都留到下一轮。
        }
        if (cancelled) {
          setSyncing(false);
          return;
        }
        const before = mutationCount.current;
        await syncNow((next) => {
          // 同步是异步的，回来时用户可能已经又改了本地；这种情况下丢弃这次合并，
          // 否则会把刚做的操作回滚掉。
          if (cancelled || mutationCount.current !== before) return;
          applyRemote(next);
        }, localSnapshot())
          .then((report) => {
            if (cancelled) return;
            setSyncPaused(report.pausedReason ?? null);
            // 只有这一轮真的把队列推空、且没有报错/暂停时才算「已同步」。
            // pausedReason（待对账）和 fetchSnapshot 的 catch 都是 signedIn: true，
            // 只看登录态会在离线或对账未完成时误报「已同步 · 刚刚」。
            if (report.signedIn && !report.error && !report.pausedReason && report.remaining === 0) {
              setLastSyncedAt(Date.now());
            }
            setPendingCount(report.remaining ?? 0);
          })
          .catch(() => {})
          .finally(() => {
            if (!cancelled) setSyncing(false);
          });
      })();
    };

    manualSyncRef.current = run;
    run();
    const stop = watchForeground(run);
    return () => {
      cancelled = true;
      manualSyncRef.current = () => {};
      stop();
    };
  }, [ready, sessionVersion, applyRemote, localSnapshot]);

  const manualSync = useCallback(() => {
    manualSyncRef.current();
  }, []);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => toKey(addDays(weekAnchor, index))),
    [weekAnchor]
  );

  const weekKey = toKey(weekAnchor);

  /** 内置菜 + 自建菜。自建菜在前，发现页和收藏页都能先看到自己录的。 */
  const allRecipes = useMemo(() => {
    const seen = new Set(customRecipes.map((recipe) => recipe.id));
    return [...customRecipes, ...recipes.filter((recipe) => !seen.has(recipe.id))];
  }, [customRecipes]);

  const findRecipe = useCallback(
    (id: string | null | undefined) => (id ? allRecipes.find((recipe) => recipe.id === id) : undefined),
    [allRecipes]
  );

  const recipeFor = useCallback(
    (dayPlan: DayPlan, slot: MealSlot) => {
      const id = dayPlan[slot];
      return id ? allRecipes.find((recipe) => recipe.id === id) : undefined;
    },
    [allRecipes]
  );

  const getCustomRecipes = useCallback(() => customRecipesRef.current, []);

  const pushRecipe = useCallback(
    (recipe: Recipe) =>
      pushRemote((userId) =>
        queueRecipe({
          userId,
          id: recipe.id,
          name: recipe.name,
          ingredients: recipe.ingredients,
          steps: recipe.steps,
          minutes: recipe.minutes || null,
          tags: recipe.tags,
          subtitle: recipe.subtitle,
          description: recipe.description,
          difficulty: recipe.difficulty,
          calories: recipe.calories,
          heat: recipe.heat,
          art: recipe.art,
          cover: recipe.cover,
          tips: recipe.tips,
          stepMinutes: recipe.stepMinutes,
          origin: recipe.origin,
        })
      ),
    [pushRemote]
  );

  const flushPendingMedia = useCallback(
    async (userId: string, options?: { recipeId?: string; budget?: number }) => {
      let budget = options?.budget ?? 6;
      const updated: Recipe[] = [];

      for (const recipe of customRecipesRef.current) {
        if (budget <= 0) break;
        // 刚保存的那条优先传完（封面 + 全部步骤图），别和其它菜挤同一个 6 张额度。
        if (options?.recipeId && recipe.id !== options.recipeId) continue;
        let changed = false;
        let cover = recipe.cover;
        // 封面和步骤图同一套逻辑：path 为空但本地有文件 → 传上去、回写 path。
        if (cover && !cover.path && budget > 0) {
          const ref = { userId, recipeId: recipe.id, imageId: cover.id };
          const file = cachedMediaFile(ref);
          if (file) {
            try {
              const path = await uploadMedia(ref, file.uri);
              await adoptLocalMedia(ref, file.uri);
              cover = { ...cover, path };
              budget -= 1;
              changed = true;
            } catch {
              // 同上：下一轮再试。
            }
          }
        }
        const steps: RecipeStep[] = [];

        for (const step of recipe.steps) {
          const images = step.images;
          if (!images?.length) {
            steps.push(step);
            continue;
          }
          const nextImages = [];
          for (const image of images) {
            if (image.path || budget <= 0) {
              nextImages.push(image);
              continue;
            }
            const ref = { userId, recipeId: recipe.id, imageId: image.id };
            const file = cachedMediaFile(ref);
            if (!file) {
              nextImages.push(image);
              continue;
            }
            try {
              const path = await uploadMedia(ref, file.uri);
              await adoptLocalMedia(ref, file.uri);
              nextImages.push({ ...image, path });
              budget -= 1;
              changed = true;
            } catch {
              // 传不上去就留着，下一轮再试；不要阻断其他表和这一轮的同步。
              nextImages.push(image);
            }
          }
          steps.push({ ...step, images: nextImages });
        }

        if (changed) updated.push({ ...recipe, steps, ...(cover ? { cover } : {}) });
      }

      if (!updated.length) return;
      const byId = new Map(updated.map((recipe) => [recipe.id, recipe]));
      const merged = customRecipesRef.current.map((recipe) => byId.get(recipe.id) ?? recipe);
      customRecipesRef.current = merged;
      setCustomRecipes(merged);
      // path 变了，行也要重推一次，否则云端还是旧的那条。
      for (const recipe of updated) pushRecipe(recipe);
    },
    [pushRecipe]
  );
  useEffect(() => {
    flushMediaRef.current = flushPendingMedia;
  }, [flushPendingMedia]);

  /**
   * 选完图那一刻，文件还在 picker 的临时目录里，图片对象上挂着 `localUri`。
   * 这串地址换台设备就是死链，所以必须尽早搬进缓存目录：
   * `document/recipe-media/{userId|guest}/{recipeId}/{imageId}.jpg`。
   *
   * 搬完就把 `localUri` 去掉——之后 flushPendingMedia 只靠「缓存目录里有没有
   * 这个 imageId」就能补传，不依赖任何被持久化的 file://。
   */
  const adoptDraftMedia = useCallback(async (recipe: Recipe): Promise<Recipe | null> => {
    const hasLocal = Boolean(recipe.cover?.localUri) ||
      recipe.steps.some((step) => step.images?.some((image) => image.localUri));
    if (!hasLocal) return null;
    const userId = await getCurrentUserId();
    const adopt = async (image: StepImage): Promise<StepImage> => {
      if (!image.localUri) return image;
      const adopted = await adoptLocalMedia(
        { userId, recipeId: recipe.id, imageId: image.id },
        image.localUri
      );
      // 搬失败（Web 无 documentDirectory、临时文件已被系统回收）就保留 localUri，
      // 至少这一轮还能显示、还能再试；直接抹掉等于图永远找不回来了。
      if (!adopted) return image;
      const rest = { ...image };
      delete rest.localUri;
      return rest;
    };
    const cover = recipe.cover ? await adopt(recipe.cover) : undefined;
    const steps: RecipeStep[] = [];
    for (const step of recipe.steps) {
      if (!step.images?.length) {
        steps.push(step);
        continue;
      }
      const images: StepImage[] = [];
      for (const image of step.images) images.push(await adopt(image));
      steps.push({ ...step, images });
    }
    return { ...recipe, ...(cover ? { cover } : {}), steps };
  }, []);

  /**
   * 新建自建菜。内置菜只读，绝不覆盖；id 带 `custom-` 前缀，云端按 (user_id,id)
   * upsert，换设备拉下来也是同一条。
   */
  const createRecipe = useCallback(
    (input: CustomRecipeInput, id?: string) => {
      const normalized = normalizeCustomInput(input);
      if (!normalized) return null;
      const recipe: Recipe = {
        id: id ?? newCustomRecipeId(),
        subtitle: "",
        description: "",
        difficulty: "",
        calories: 0,
        tags: [],
        ...normalized,
        updatedAt: new Date().toISOString(),
        custom: true,
      };
      setCustomRecipes((current) => [recipe, ...current]);
      customRecipesRef.current = [recipe, ...customRecipesRef.current];
      pushRecipe(recipe);
      // 选过图的先落盘再重推一次：这条推送才带得上云端 path。
      void adoptDraftMedia(recipe).then(async (adopted) => {
        // 没有可搬的图也照样立刻 flush：游客态刚登录、断网后补传都靠这一下。
        const next = adopted ?? recipe;
        if (adopted) {
          customRecipesRef.current = customRecipesRef.current.map((item) =>
            item.id === adopted.id ? adopted : item
          );
          setCustomRecipes(customRecipesRef.current);
          pushRecipe(adopted);
        }
        const userId = await getCurrentUserId();
        if (userId) await flushMediaRef.current?.(userId, { recipeId: next.id, budget: 200 });
      });
      return recipe;
    },
    [adoptDraftMedia, pushRecipe]
  );

  /**
   * 编辑自建菜。内置菜是常量、别人的菜谱不在本机，两者都不允许改——这里按 id
   * 在 customRecipes 里查，查不到直接返回 null，避免误覆盖。
   */
  const updateRecipe = useCallback(
    (id: string, input: CustomRecipeInput) => {
      const current = customRecipesRef.current.find((recipe) => recipe.id === id);
      if (!current) return null;
      const normalized = normalizeCustomInput(input);
      if (!normalized) return null;
      const recipe: Recipe = { ...current, ...normalized, updatedAt: new Date().toISOString(), custom: true };
      const next = customRecipesRef.current.map((item) => (item.id === id ? recipe : item));
      customRecipesRef.current = next;
      setCustomRecipes(next);
      pushRecipe(recipe);
      void adoptDraftMedia(recipe).then(async (adopted) => {
        // 没有可搬的图也照样立刻 flush：游客态刚登录、断网后补传都靠这一下。
        const next = adopted ?? recipe;
        if (adopted) {
          customRecipesRef.current = customRecipesRef.current.map((item) =>
            item.id === adopted.id ? adopted : item
          );
          setCustomRecipes(customRecipesRef.current);
          pushRecipe(adopted);
        }
        const userId = await getCurrentUserId();
        if (userId) await flushMediaRef.current?.(userId, { recipeId: next.id, budget: 200 });
      });
      return recipe;
    },
    [adoptDraftMedia, pushRecipe]
  );

  /**
   * 删除自建菜：本地移除 + 云端写 tombstone（deleted=true，别的设备 pull 时据此删掉）。
   * 顺手撤掉计划里排了这道菜的餐位、取消收藏，并清掉本机缓存和 Storage 里的图。
   * 做饭记录和评分留着：那是历史，删菜不该改写。
   */
  const deleteRecipe = useCallback(
    (id: string) => {
      const current = customRecipesRef.current.find((recipe) => recipe.id === id);
      if (!current) return false;
      const next = customRecipesRef.current.filter((recipe) => recipe.id !== id);
      customRecipesRef.current = next;
      setCustomRecipes(next);
      pushRemote((userId) =>
        queueRecipe({ userId, id, name: current.name, ingredients: [], steps: [], deleted: true })
      );

      const slots: { dateKey: string; slot: MealSlot }[] = [];
      const nextPlan: PlanMap = {};
      for (const [dateKey, day] of Object.entries(planRef.current)) {
        const kept = { ...day };
        for (const [slot, recipeId] of Object.entries(day)) {
          if (recipeId !== id) continue;
          delete kept[slot as MealSlot];
          slots.push({ dateKey, slot: slot as MealSlot });
        }
        nextPlan[dateKey] = kept;
      }
      if (slots.length) {
        planRef.current = nextPlan;
        setPlan(nextPlan);
        pushRemote((userId) =>
          Promise.all(
            slots.map((item) => queuePlanSlot({ userId, dayKey: item.dateKey, slot: item.slot, recipeId: null }))
          ).then(() => undefined)
        );
      }

      if (favoritesRef.current.includes(id)) {
        favoritesRef.current = favoritesRef.current.filter((item) => item !== id);
        setFavorites(favoritesRef.current);
        pushRemote((userId) => queuePrefs({ userId, recipeId: id, favorite: false }));
      }

      void (async () => {
        const userId = await getCurrentUserId();
        await removeRecipeMedia({ userId, recipeId: id });
        // 游客期建的菜图片在 guest/ 目录，登录后删也要清。
        if (userId) await removeRecipeMedia({ userId: null, recipeId: id });
      })();
      return true;
    },
    [pushRemote]
  );

  const setMeal = useCallback((dateKey: string, slot: MealSlot, recipeId: string | null) => {
    setPlan((current) => {
      const day = { ...(current[dateKey] ?? {}) };
      if (recipeId) day[slot] = recipeId;
      else delete day[slot];
      return { ...current, [dateKey]: day };
    });
    pushRemote((userId) =>
      queuePlanSlot({
        userId,
        dayKey: dateKey,
        slot,
        recipeId,
        servings: servingsRef.current[recipeId ?? ""] ?? 1,
      })
    );
  }, [pushRemote]);

  const applyPlan = useCallback((next: PlanMap) => {
    setPlan(next);
  }, []);

  /** 空周引导：优先用收藏，没有收藏就从菜谱库挑，补满连续三天里空着的餐位。 */
  const planThreeDays = useCallback(
    (anchorKey?: string) => {
      const pool = planPool(favorites, allRecipes.map((recipe) => recipe.id));
      const today = toKey(new Date());
      // 看的是哪一周就排哪一周：本周从今天开始，其它周从周一开始（否则会排进用户看不见的那周）。
      const base = weekDays.includes(today)
        ? parseKey(today)
        : weekDays.includes(anchorKey ?? selectedDate)
          ? parseKey(anchorKey ?? selectedDate)
          : parseKey(weekDays[0]);
      const next: PlanMap = { ...plan };
      const startIndex = weekDays.indexOf(toKey(base));
      // 只在当前这一周内排，跨周会排进用户看不见的那周。
      const span = startIndex >= 0 ? Math.min(3, weekDays.length - startIndex) : 3;
      let cursor = 0;
      let placed = 0;
      // 批量排餐同样要进 outbox，否则「帮我排 3 天」这条路永远只写本地。
      const queued: { dateKey: string; slot: MealSlot; recipeId: string }[] = [];
      for (let offset = 0; offset < span; offset += 1) {
        const key = toKey(addDays(base, offset));
        const day = { ...(next[key] ?? {}) };
        mealSlots.forEach((slot) => {
          if (day[slot]) return;
          day[slot] = pool[cursor % pool.length];
          queued.push({ dateKey: key, slot, recipeId: day[slot] });
          cursor += 1;
          placed += 1;
        });
        next[key] = day;
      }
      if (placed > 0) {
        setPlan(next);
        planRef.current = next;
        pushRemote((userId) =>
          Promise.all(
            queued.map((item) =>
              queuePlanSlot({ userId, dayKey: item.dateKey, slot: item.slot, recipeId: item.recipeId })
            )
          ).then(() => undefined)
        );
      }
      return placed;
    },
    [favorites, allRecipes, selectedDate, weekDays, plan, pushRemote]
  );

  const clearDay = useCallback((dateKey: string) => {
    const cleared = Object.keys(planRef.current[dateKey] ?? {});
    setPlan((current) => ({ ...current, [dateKey]: {} }));
    // 每个被清掉的餐位各写一条 tombstone，其它设备才知道这些格子被撤了。
    if (!cleared.length) return;
    pushRemote((userId) =>
      Promise.all(
        cleared.map((slot) => queuePlanSlot({ userId, dayKey: dateKey, slot, recipeId: null }))
      ).then(() => undefined)
    );
  }, [pushRemote]);

  const rateRecipe = useCallback((recipeId: string, stars: number) => {
    setRatings((current) => ({ ...current, [recipeId]: stars }));
    pushRemote((userId) => queuePrefs({ userId, recipeId, rating: stars }));
  }, [pushRemote]);

  const toggleFavorite = useCallback((recipeId: string) => {
    const favorite = !favoritesRef.current.includes(recipeId);
    const next = favorite
      ? [recipeId, ...favoritesRef.current.filter((id) => id !== recipeId)]
      : favoritesRef.current.filter((id) => id !== recipeId);
    favoritesRef.current = next;
    setFavorites(next);
    pushRemote((userId) => queuePrefs({ userId, recipeId, favorite }));
  }, [pushRemote]);

  const weekRecipeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    weekDays.forEach((key) => {
      Object.values(plan[key] ?? {}).forEach((id) => {
        if (id) counts.set(id as string, (counts.get(id as string) ?? 0) + 1);
      });
    });
    return counts;
  }, [plan, weekDays]);

  const weekPlanRecipes = useMemo(
    () => allRecipes.filter((recipe) => weekRecipeCounts.has(recipe.id)),
    [allRecipes, weekRecipeCounts]
  );

  // 排上了但查不到菜的（自建菜还没拉到 / 内置菜下架）：这些菜的食材进不了清单，
  // 计划页和采购页都得说一句，不能让数字悄悄变少。
  const missingRecipeCount = useMemo(
    () => Array.from(weekRecipeCounts.keys()).filter((id) => !allRecipes.some((recipe) => recipe.id === id)).length,
    [allRecipes, weekRecipeCounts]
  );

  const shoppingItems = useMemo(() => {
    const map = new Map<string, ShoppingItem>();
    weekPlanRecipes.forEach((recipe) => {
      const portions = weekRecipeCounts.get(recipe.id) ?? 1;
      const factor = (servings[recipe.id] ?? 1) * portions;
      // 调料不进采购清单：盐、酱油这类通常家里常备，进了只会让清单变长。
      cookingIngredients(recipe).forEach((ingredient) => {
        const id = `${ingredient.name}|${ingredient.unit}`;
        const existing = map.get(id);
        const qty = ingredient.qty === null ? null : Number((ingredient.qty * factor).toFixed(2));
        if (existing) {
          if (existing.qty !== null && qty !== null) existing.qty = Number((existing.qty + qty).toFixed(2));
          if (!existing.sources.includes(recipe.name)) existing.sources.push(recipe.name);
        } else {
          map.set(id, {
            id,
            name: ingredient.name,
            qty,
            unit: ingredient.unit,
            checked: false,
            sources: [recipe.name],
          });
        }
      });
    });
    const alreadyCarried = new Set(carried[weekKey] ?? []);
    // 用户手动移除了的派生项：菜单里还在，但这一周的清单不再出现（可在「已移除」里恢复）。
    const hidden = [...map.values()].filter((item) => !removed[`${weekKey}::${item.id}`]);
    const merged = hidden.filter((item) => !alreadyCarried.has(item.id)).map((item) => {
      const carry = carryQty[`${weekKey}::${item.id}`] ?? 0;
      const base = qtyOverrides[`${weekKey}::${item.id}`] ?? item.qty;
      return {
        ...item,
        qty: base === null ? null : Number((base + carry).toFixed(2)),
        checked: Boolean(checked[`${weekKey}::${item.id}`]),
      };
    });
    const manual: ShoppingItem[] = manualItems
      .filter((item) => (!item.weekKey || item.weekKey === weekKey) && !(carried[weekKey] ?? []).includes(item.id))
      .map((item) => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      checked: item.checked,
      sources: item.sources?.length ? item.sources : ["手动添加"],
    }));
    const all = [...manual, ...merged];
    return all.sort((a, b) => Number(a.checked) - Number(b.checked));
  }, [weekPlanRecipes, weekRecipeCounts, servings, checked, qtyOverrides, removed, manualItems, carryQty, carried, weekKey]);

  const pendingItems = useMemo(() => shoppingItems.filter((item) => !item.checked), [shoppingItems]);

  /** 这一周被移除的派生食材（按菜单现算的名称，用于「已移除 N 项 · 恢复」）。 */
  const removedItems = useMemo(() => {
    const names = new Map<string, string>();
    weekPlanRecipes.forEach((recipe) => {
      cookingIngredients(recipe).forEach((ingredient) => {
        const id = `${ingredient.name}|${ingredient.unit}`;
        if (removed[`${weekKey}::${id}`]) names.set(id, ingredient.name);
      });
    });
    return [...names.entries()].map(([id, name]) => ({ id, name }));
  }, [weekPlanRecipes, removed, weekKey]);

  /** 从清单里移除一种食材：派生项只记排除（菜单不动），手动项直接删。 */
  const removeItem = useCallback(
    (id: string) => {
      if (id.startsWith("manual-")) {
        const target = manualItemsRef.current.find((item) => item.id === id);
        setManualItems((current) => current.filter((item) => item.id !== id));
        if (!target?.weekKey) return;
        pushRemote((userId) =>
          queueManualItem({
            userId,
            weekKey: target.weekKey as string,
            id: target.id,
            name: target.name,
            qty: target.qty,
            unit: target.unit,
            checked: target.checked,
            sources: target.sources ?? [],
            deleted: true,
          })
        );
        return;
      }
      const key = `${weekKey}::${id}`;
      setRemoved((current) => ({ ...current, [key]: true }));
      setChecked((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
      setQtyOverrides((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
      pushRemote((userId) => queueDerivedItem({ userId, weekKey, id, deleted: true }));
    },
    [weekKey, pushRemote]
  );

  const restoreRemoved = useCallback(
    (id: string) => {
      const key = `${weekKey}::${id}`;
      setRemoved((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      pushRemote((userId) =>
        queueDerivedItem({ userId, weekKey, id, checked: Boolean(checkedRef.current[key]), qty: null })
      );
    },
    [weekKey, pushRemote]
  );

  const toggleChecked = useCallback((id: string) => {
    if (id.startsWith("manual-")) {
      const target = manualItemsRef.current.find((item) => item.id === id);
      if (!target) return;
      const next = { ...target, checked: !target.checked };
      setManualItems((current) => current.map((item) => (item.id === id ? next : item)));
      if (!next.weekKey) return;
      pushRemote((userId) =>
        queueManualItem({
          userId,
          weekKey: next.weekKey as string,
          id: next.id,
          name: next.name,
          qty: next.qty,
          unit: next.unit,
          checked: next.checked,
          sources: next.sources ?? [],
        })
      );
      return;
    }
    const key = `${weekKey}::${id}`;
    const next = !checkedRef.current[key];
    setChecked((current) => ({ ...current, [key]: next }));
    pushRemote((userId) => queueDerivedItem({ userId, weekKey, id, checked: next }));
  }, [weekKey, pushRemote]);

  const setQty = useCallback((id: string, qty: number) => {
    if (id.startsWith("manual-")) {
      const target = manualItemsRef.current.find((item) => item.id === id);
      if (!target) return;
      const next = { ...target, qty };
      setManualItems((current) => current.map((item) => (item.id === id ? next : item)));
      if (!next.weekKey) return;
      pushRemote((userId) =>
        queueManualItem({
          userId,
          weekKey: next.weekKey as string,
          id: next.id,
          name: next.name,
          qty: next.qty,
          unit: next.unit,
          checked: next.checked,
          sources: next.sources ?? [],
        })
      );
      return;
    }
    const key = `${weekKey}::${id}`;
    setQtyOverrides((current) => ({ ...current, [key]: qty }));
    pushRemote((userId) => queueDerivedItem({ userId, weekKey, id, qty }));
  }, [weekKey, pushRemote]);

  const addManualItem = useCallback(
    (name: string, qty: number | null, unit: string) => {
      const item: ManualItem = { id: uid("manual"), name, qty, unit, checked: false, weekKey };
      setManualItems((current) => [item, ...current]);
      pushRemote((userId) =>
        queueManualItem({ userId, weekKey, id: item.id, name, qty, unit, checked: false })
      );
    },
    [weekKey, pushRemote]
  );

  const removeManualItem = useCallback((id: string) => {
    const target = manualItemsRef.current.find((item) => item.id === id);
    setManualItems((current) => current.filter((item) => item.id !== id));
    // 服务端保留 tombstone，否则其它设备下次 pull 会把它加回来。
    if (!target?.weekKey) return;
    pushRemote((userId) =>
      queueManualItem({
        userId,
        weekKey: target.weekKey as string,
        id: target.id,
        name: target.name,
        qty: target.qty,
        unit: target.unit,
        checked: target.checked,
        sources: target.sources ?? [],
        deleted: true,
      })
    );
  }, [pushRemote]);

  const resetChecked = useCallback(() => {
    setChecked((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${weekKey}::`)))
    );
    setManualItems((current) =>
      current.map((item) =>
        !item.weekKey || item.weekKey === weekKey ? { ...item, checked: false } : item
      )
    );
  }, [weekKey]);

  const setServings = useCallback((recipeId: string, value: number) => {
    const servings = Math.min(6, Math.max(1, value));
    setServingsMap((current) => ({ ...current, [recipeId]: servings }));
    pushRemote((userId) => queuePrefs({ userId, recipeId, servings }));
  }, [pushRemote]);

  const logCooked = useCallback((recipeId: string) => {
    const date = toKey(new Date());
    setCookedLog((current) => [{ date, recipeId }, ...current].slice(0, 200));
    pushRemote((userId) => queueCookLog({ userId, recipeId, cookedOn: date }));
  }, [pushRemote]);

  const exportBackup = useCallback(() => {
    const payload: PersistedState = {
      plan,
      favorites,
      checked,
      qtyOverrides,
      removed,
      manualItems,
      ratings,
      servings,
      cookedLog,
      // 备份里也只能有 path：localUri 换台设备就是死链。
      customRecipes: customRecipes.map((recipe) => ({
        ...recipe,
        ...(recipe.cover ? { cover: persistableImage(recipe.cover) } : {}),
        steps: persistableSteps(recipe.steps),
      })),
      carryQty,
      carried,
    };
    return JSON.stringify(
      {
        app: "haohao-chifan",
        version: 1,
        source: "account" as const,
        exportedAt: new Date().toISOString(),
        data: payload,
      },
      null,
      2
    );
  }, [plan, favorites, checked, qtyOverrides, removed, manualItems, ratings, servings, cookedLog, customRecipes, carryQty, carried]);

  /**
   * 游客那份备份必须直接序列化待处理快照：此刻内存里已经是账号数据了，
   * 用 exportBackup() 会把账号内容当成「游客备份」交给用户，等于没备。
   */
  const exportGuestBackup = useCallback(() => {
    const pending = pendingGuestRef.current;
    if (!pending) return null;
    return JSON.stringify(
      {
        app: "haohao-chifan",
        version: 1,
        source: "guest" as const,
        exportedAt: new Date().toISOString(),
        data: pending.guest,
      },
      null,
      2
    );
  }, []);

  const importBackup = useCallback(async (raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "文件不是有效的 JSON" };
    }
    const root = parsed as { app?: string; source?: "guest" | "account"; data?: Partial<PersistedState> };
    const data = root?.data;
    if (!data || typeof data !== "object") return { ok: false, error: "缺少 data 字段，可能不是好好吃饭的备份" };
    if (root.app && root.app !== "haohao-chifan") return { ok: false, error: "这是其他应用的备份文件" };
    if (data.plan && typeof data.plan !== "object") return { ok: false, error: "plan 字段格式不对" };

    // 导入是「整体替换」：先记下替换前的状态，之后按差量补 tombstone，
    // 否则云端那份多出来的餐位会在下次 pull 时原样长回来。
    const prev: LocalState = {
      plan: planRef.current,
      favorites: favoritesRef.current,
      ratings: ratingsRef.current,
      servings: servingsRef.current,
      checked: checkedRef.current,
      qtyOverrides: qtyOverridesRef.current,
      removed: removedRef.current,
      manualItems: manualItemsRef.current,
      cookedLog: cookedLogRef.current,
      customRecipes: customRecipesRef.current,
    };

    const nextPlan = (data.plan ?? {}) as PlanMap;
    const nextFavorites = data.favorites ?? [];
    const nextChecked = withWeekPrefix(data.checked ?? {});
    const nextQty = withWeekPrefix(data.qtyOverrides ?? {});
    const nextRemoved = data.removed ?? {};
    const nextManual = data.manualItems ?? [];
    const nextRatings = data.ratings ?? {};
    const nextServings = data.servings ?? {};
    const nextCooked = data.cookedLog ?? [];
    const nextCustom = data.customRecipes ?? customRecipesRef.current;
    const nextCarryQty = data.carryQty ?? {};
    const nextCarried = data.carried ?? {};
    const replaced = {
      plan: Object.values(planRef.current).reduce((sum, day) => sum + Object.keys(day ?? {}).length, 0),
      favorites: favoritesRef.current.length,
    };

    planRef.current = nextPlan;
    favoritesRef.current = nextFavorites;
    checkedRef.current = nextChecked;
    qtyOverridesRef.current = nextQty;
    removedRef.current = nextRemoved;
    manualItemsRef.current = nextManual;
    ratingsRef.current = nextRatings;
    servingsRef.current = nextServings;
    cookedLogRef.current = nextCooked;
    customRecipesRef.current = nextCustom;

    setPlan(nextPlan);
    setFavorites(nextFavorites);
    setChecked(nextChecked);
    setQtyOverrides(nextQty);
    setRemoved(nextRemoved);
    setManualItems(nextManual);
    setRatings(nextRatings);
    setServingsMap(nextServings);
    setCookedLog(nextCooked);
    setCustomRecipes(nextCustom);
    setCarryQty(nextCarryQty);
    setCarried(nextCarried);

    // 导入也是一次本地写：计数 +1 让飞行中的 pull 结果被丢弃，不能回头盖掉刚恢复的菜单。
    mutationCount.current += 1;
    const userId = userIdRef.current;
    if (userId) {
      const next: LocalState = {
        plan: nextPlan,
        favorites: nextFavorites,
        ratings: nextRatings,
        servings: nextServings,
        checked: nextChecked,
        qtyOverrides: nextQty,
        removed: nextRemoved,
        manualItems: nextManual,
        cookedLog: nextCooked,
        customRecipes: nextCustom,
      };
      // 差量基准要带上云端：本机 blob 可能落后，云端有、本机没有的行不撤就会在
      // 下次 pull 原样复活。拉取失败不阻塞导入，但要落补账标记——否则恢复网络后
      // pull 会把这些行原样拉回来，用户看到「导入完过一会儿又变回去」。
      const remote = await fetchSnapshot().catch(() => null);
      if (!remote) await markPendingReconcile(userId);
      await queueReplaceAll(userId, prev, next, remote);
      scheduleFlush(0);
      return { ok: true, source: root.source ?? "account", degraded: !remote, replaced };
    }
    return { ok: true, source: root.source ?? "account", replaced };
  }, []);

  const markExported = useCallback(() => setLastExportAt(new Date().toISOString()), []);

  /**
   * 用户对「游客改动要不要并入账号」的选择。无论并还是先不并都记下已询问，
   * 之后不再重复弹；不并时游客那份原样留着，登出后仍然看得到，不会被覆盖。
   */
  /**
   * 「我的」页常驻的「合并本机数据」入口：重新把那份游客快照摆出来让用户再选一次。
   * 与登录时的弹卡共用同一个 pendingGuestRef / GuestMergePrompt，不另写一套合并逻辑。
   */
  const reopenGuestMerge = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    try {
      const guestRaw = await AsyncStorage.getItem(guestKey);
      if (!guestRaw) return;
      const guest = JSON.parse(guestRaw) as Partial<PersistedState>;
      if (!hasContent(guest)) return;
      pendingGuestRef.current = {
        userId,
        guest,
        account: {
          plan: planRef.current,
          favorites: favoritesRef.current,
          ratings: ratingsRef.current,
          servings: servingsRef.current,
          checked: checkedRef.current,
          qtyOverrides: qtyOverridesRef.current,
          removed: removedRef.current,
          manualItems: manualItemsRef.current,
          cookedLog: cookedLogRef.current,
          customRecipes: customRecipesRef.current,
        },
        guestRaw,
      };
      setGuestMerge({
        planCount: Object.values(guest.plan ?? {}).reduce(
          (total, day) => total + Object.keys(day ?? {}).length,
          0
        ),
        favoriteCount: guest.favorites?.length ?? 0,
        manualCount: guest.manualItems?.length ?? 0,
      });
    } catch {
      // 游客快照读不出来就当没有，不阻塞页面。
    }
  }, []);

  const resolveGuestMerge = useCallback((merge: boolean) => {
    const pending = pendingGuestRef.current;
    pendingGuestRef.current = null;
    setGuestMerge(null);
    if (!pending) return;
    const { userId, guest, account, guestRaw } = pending;
    const markPrompted = (raw: string) =>
      AsyncStorage.setItem(guestPromptKey(userId), fingerprint(raw)).catch(() => {});
    if (!merge) {
      // 不并：游客那份原样留着，只记下「这份内容问过了」，用户再改还会再问。
      // 指纹用卡片弹出时快照的原串，不重新读——卡片开着期间 pull 回来会让指纹漂走。
      setGuestLocalOnly(true);
      markPrompted(guestRaw);
      return;
    }
    setGuestLocalOnly(false);
    const merged = mergeGuestIntoAccount(account, guest);
    const accountKey = storageKeyFor(userId);
    planRef.current = merged.plan;
    favoritesRef.current = merged.favorites;
    ratingsRef.current = merged.ratings;
    servingsRef.current = merged.servings;
    checkedRef.current = merged.checked;
    qtyOverridesRef.current = merged.qtyOverrides;
    removedRef.current = merged.removed ?? {};
    manualItemsRef.current = merged.manualItems;
    cookedLogRef.current = merged.cookedLog;
    customRecipesRef.current = merged.customRecipes ?? [];

    setPlan(merged.plan as PlanMap);
    setFavorites(merged.favorites);
    setRatings(merged.ratings);
    setServingsMap(merged.servings);
    setChecked(merged.checked);
    setQtyOverrides(merged.qtyOverrides);
    setRemoved(merged.removed ?? {});
    setManualItems(merged.manualItems as ManualItem[]);
    setCookedLog(merged.cookedLog);
    setCustomRecipes(merged.customRecipes ?? []);
    setCarryQty(merged.carryQty ?? {});
    setCarried(merged.carried ?? {});

    const serialized = JSON.stringify(payloadOf(merged, lastExportAtRef.current));
    AsyncStorage.setItem(accountKey, serialized)
      .then(() => Promise.all([AsyncStorage.setItem(guestKey, serialized), AsyncStorage.removeItem(GUEST_DIRTY_KEY)]))
      .then(() => markPrompted(serialized))
      .catch(() => {});
    guestBaselineRef.current = serialized;
    // 并入后立刻推一次：合并结果只在本机，云端还没有。
    seedFromLocal(userId, merged as LocalState)
      .then(() => scheduleFlush(0))
      .catch(() => {});
  }, []);

  const carryPending = useCallback(() => {
    const nextWeekKey = toKey(addDays(weekAnchor, 7));
    const nextDays = Array.from({ length: 7 }, (_, index) => toKey(addDays(weekAnchor, index + 7)));
    const nextCounts = new Map<string, number>();
    nextDays.forEach((key) => {
      Object.values(plan[key] ?? {}).forEach((id) => {
        if (id) nextCounts.set(id, (nextCounts.get(id) ?? 0) + 1);
      });
    });
    const nextDerived = new Map<string, { qty: number | null; unit: string; name: string }>();
    allRecipes.forEach((recipe) => {
      const portions = nextCounts.get(recipe.id);
      if (!portions) return;
      const factor = (servings[recipe.id] ?? 1) * portions;
      cookingIngredients(recipe).forEach((ingredient) => {
        const id = `${ingredient.name}|${ingredient.unit}`;
        const qty = ingredient.qty === null ? null : Number((ingredient.qty * factor).toFixed(2));
        const existing = nextDerived.get(id);
        if (existing) {
          if (existing.qty !== null && qty !== null) existing.qty = Number((existing.qty + qty).toFixed(2));
        } else {
          nextDerived.set(id, { name: ingredient.name, qty, unit: ingredient.unit });
        }
      });
    });

    const carryDelta: Record<string, number> = {};
    const additions: ManualItem[] = [];
    const carriedIds: string[] = [];
    let moved = 0;
    let merged = 0;

    pendingItems.forEach((item) => {
      moved += 1;
      carriedIds.push(item.id);
      const derived = nextDerived.get(item.id);
      const existingManual = manualItems.find(
        (entry) => entry.weekKey === nextWeekKey && entry.name === item.name && entry.unit === item.unit
      );
      if (derived) {
        if (item.qty !== null) {
          const key = `${nextWeekKey}::${item.id}`;
          carryDelta[key] = Number(((carryDelta[key] ?? 0) + item.qty).toFixed(2));
          merged += 1;
        }
        return;
      }
      if (existingManual) {
        if (existingManual.qty !== null && item.qty !== null) {
          existingManual.qty = Number((existingManual.qty + item.qty).toFixed(2));
          merged += 1;
        }
        return;
      }
      additions.push({
        id: uid("manual"),
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        checked: false,
        weekKey: nextWeekKey,
        sources: item.sources,
      });
    });

    if (moved > 0) {
      // 记住顺延前的状态，撤回时整体还原，避免逐项反算误差
      carryUndoRef.current = { weekKey, carryQty, manualItems, carried };
      setCarried((current) => ({
        ...current,
        [weekKey]: Array.from(new Set([...(current[weekKey] ?? []), ...carriedIds])),
      }));
    }
    if (additions.length) setManualItems((current) => [...additions, ...current]);
    if (Object.keys(carryDelta).length) {
      setCarryQty((current) => {
        const next = { ...current };
        Object.entries(carryDelta).forEach(([key, value]) => {
          next[key] = Number(((next[key] ?? 0) + value).toFixed(2));
        });
        return next;
      });
    }
    return { moved, merged };
  }, [allRecipes, weekAnchor, plan, servings, pendingItems, manualItems, carryQty, carried, weekKey]);

  const undoCarry = useCallback(() => {
    const snapshot = carryUndoRef.current;
    if (!snapshot) return;
    setCarryQty(snapshot.carryQty);
    setManualItems(snapshot.manualItems);
    setCarried(snapshot.carried);
    carryUndoRef.current = null;
  }, []);

  const shiftWeek = useCallback((delta: number) => {
    setWeekAnchor((current) => addDays(current, delta * 7));
  }, []);

  const trippedCount = shoppingItems.filter((item) => item.checked).length;

  const cookedThisWeek = cookedLog.filter((entry) => weekDays.includes(entry.date)).length;

  const value: Store = {
    ready,
    syncPaused,
    lastSyncedAt,
    pendingCount,
    syncNow: manualSync,
    syncing,
    guestMerge,
    resolveGuestMerge,
    reopenGuestMerge,
    guestLocalOnly,
    plan,
    favorites,
    selectedDate,
    setSelectedDate,
    setMeal,
    clearDay,
    applyPlan,
    planThreeDays,
    toggleFavorite,
    ratings,
    rateRecipe,
    allRecipes,
    customRecipes,
    getCustomRecipes,
    findRecipe,
    recipeFor,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    shoppingItems,
    missingRecipeCount,
    trippedCount,
    toggleChecked,
    setQty,
    addManualItem,
    removeManualItem,
    removeItem,
    removedItems,
    restoreRemoved,
    resetChecked,
    weekKey,
    weekDays,
    shiftWeek,
    servings,
    setServings,
    cookedLog,
    logCooked,
    cookedThisWeek,
    carryPending,
    undoCarry,
    carriedCount: (carried[weekKey] ?? []).length,
    exportBackup,
    exportGuestBackup,
    importBackup,
    lastExportAt,
    markExported,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}

