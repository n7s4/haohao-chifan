/**
 * 把小红书笔记 / 抖音截图 / 一段文字交给服务端 AI，拿回一份「草稿」——不是直接入库的结构。
 *
 * 客户端只负责 base64 和错误码翻译：模型 key、限流、重试都在 Edge Function 里，
 * 任何 `EXPO_PUBLIC_*` 都会被编译进 bundle，放 key 等于把它送给解包的人。
 */
import * as FileSystem from "expo-file-system/legacy";

import {
  extractShareUrl,
  isAllowedHost,
  isLoginOrBlockedUrl,
  noteToText,
  parseNotePage,
  transcriptText,
} from "../../supabase/functions/fetch-xhs-note/xhs";
import { getSupabase, isSupabaseConfigured } from "./supabase";

export type DraftIngredient = { name: string; qty: number | null; unit: string };
export type ImportedDraft = {
  name: string;
  minutes: number | null;
  ingredients: DraftIngredient[];
  seasonings: DraftIngredient[];
  /**
   * `imageUris`：AI 认为拍的就是这一步的图（来自导入时的图片列表）。
   * `videoAt`：视频笔记里这一步画面的秒数，配合 `videoUrl` 截帧当步骤图。
   */
  steps: { text: string; imageUris?: string[]; videoAt?: number | null }[];
  /** 视频笔记的视频地址（手机解析页面得到，不经服务端）。 */
  videoUrl?: string | null;
  /** AI 认出来的成品图；没有就不给。 */
  coverUri?: string;
  sourceUrl: string | null;
};

/** 服务端返回的是图片下标，客户端换成 uri 后才是 ImportedDraft。 */
type ServerDraft = Omit<ImportedDraft, "steps" | "coverUri"> & {
  steps: { text: string; images?: number[]; videoAt?: number | null }[];
  coverImage?: number | null;
};

export type ImportErrorCode =
  | "offline"
  | "not_configured"
  | "invalid_input"
  | "invalid_link"
  | "fetch_blocked"
  | "note_unavailable"
  | "image_too_large"
  | "not_recipe"
  | "no_steps"
  | "rate_limited"
  | "session_expired"
  | "timeout"
  | "upstream"
  | "unknown";

export class ImportError extends Error {
  code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const fallbackMessage = (code: ImportErrorCode) => {
  switch (code) {
    case "offline":
      return "现在没有网络，AI 解析要联网才能用。可以先用「手动填写」录下来，或者连上网再试。";
    case "not_configured":
      return "解析服务还没部署或没配置好，先手动填写吧。";
    case "not_recipe":
      return "这段内容看着不像菜谱，换一段带食材和做法的文字试试。";
    case "no_steps":
      return "只找到食材、没找到做法步骤，补一段做法再试。";
    case "rate_limited":
      return "今天的 AI 解析次数用完了，明天再试，或者先手动填写。";
    case "session_expired":
      return "登录状态已过期，重新登录后再试。";
    case "timeout":
      return "解析超时了，网络好的时候再点一次。";
    case "upstream":
      return "解析服务暂时不可用，稍后再试。";
    case "image_too_large":
      return "这张图太大了，换一张小一点的截图。";
    case "invalid_link":
      return "这不是小红书笔记链接，复制分享里的链接再试。";
    case "fetch_blocked":
      return "小红书暂时不让读这条笔记，先截图或者把正文贴进来。";
    case "note_unavailable":
      return "这条笔记打不开了，可能已删除或设为私密。";
    default:
      return "这次没解析成功，换一段内容或手动填写。";
  }
};

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const TIMEOUT_MS = 90_000;
/** 9 张 1600/0.8 的截图 base64 大概 6~9MB，给到 12MB 留余量；服务端是同一个数。 */
const MAX_TOTAL_CHARS = 12_000_000;

/**
 * 直接 fetch 而不是 `functions.invoke`：invoke 在非 2xx 时只给一个 FunctionsHttpError，
 * 拿不到 422/503 里那段带 `code` 的 JSON，所有失败会被糊成同一条文案。
 * 这里按状态码自己解，服务端给的 not_recipe / no_steps 才能原样传到界面。
 */
/** 只用来区分「断网」和「函数不可达」：健康检查不需要 key 也不需要用户态。 */
async function probeReachable(): Promise<boolean> {
  // Hermes 上 AbortSignal.timeout 不一定有，用 controller + setTimeout 更稳。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const echo = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_KEY as string },
      signal: controller.signal,
    });
    return echo.ok || echo.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const KNOWN_CODES: ImportErrorCode[] = [
  "not_configured", "invalid_input", "invalid_link", "fetch_blocked", "note_unavailable", "image_too_large",
  "not_recipe", "no_steps", "rate_limited", "session_expired", "timeout", "upstream",
];

/** 两个函数（import-recipe / fetch-xhs-note）共用：发请求、把状态码和 `code` 翻成 ImportError。 */
async function callFunction<T>(name: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  if (!isSupabaseConfigured || !SUPABASE_URL || !SUPABASE_KEY) {
    throw new ImportError("not_configured", fallbackMessage("not_configured"));
  }

  const { data: sessionData } = await getSupabase().auth.getSession();
  const token = sessionData.session?.access_token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token ?? SUPABASE_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (problem) {
    if (problem instanceof Error && problem.name === "AbortError") {
      throw new ImportError("timeout", fallbackMessage("timeout"));
    }
    // fetch 抛错有两种完全不同的原因：真的断网，或者函数没部署时 Web 端
    // CORS 预检直接失败。探一下同一个 Supabase 项目的健康检查接口，
    // 能通就说明是后者——别让用户在 Wi-Fi 满格时被告知「没有网络」。
    const reachable = await probeReachable();
    const code = reachable ? "not_configured" : "offline";
    throw new ImportError(code, fallbackMessage(code));
  } finally {
    clearTimeout(timer);
  }

  let payload: (T & { error?: { code?: string; message?: string } }) | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const serverCode = payload?.error?.code as ImportErrorCode | undefined;
  // 服务端自己说清楚的错误（比如 404 note_unavailable）优先；
  // 没带 code 的才按状态码猜：网关 404 = 函数没部署，401 = JWT 过期连函数都没进。
  if (serverCode && KNOWN_CODES.includes(serverCode)) {
    throw new ImportError(serverCode, payload?.error?.message || fallbackMessage(serverCode));
  }
  if (response.status === 404 || response.status === 503) {
    throw new ImportError("not_configured", fallbackMessage("not_configured"));
  }
  if (response.status === 429) {
    throw new ImportError("rate_limited", fallbackMessage("rate_limited"));
  }
  if (response.status === 401) {
    throw new ImportError("session_expired", fallbackMessage("session_expired"));
  }
  if (!response.ok || !payload || payload.error) {
    throw new ImportError("upstream", payload?.error?.message || fallbackMessage("upstream"));
  }
  return payload;
}

type ImportBody = {
  text?: string;
  images?: { base64: string; mime: string }[];
  imageUrls?: string[];
  importTicket?: string;
  sourceUrl?: string;
};

/** `sentUris[i]` 是请求里第 i 张图的来源，用来把 AI 给的下标换回 uri。 */
async function invoke(body: ImportBody, sentUris: string[] = []): Promise<ImportedDraft> {
  const payload = await callFunction<{ draft?: ServerDraft }>("import-recipe", body);
  if (!payload.draft) throw new ImportError("upstream", fallbackMessage("upstream"));
  const { coverImage, steps, ...rest } = payload.draft;
  const uriAt = (index: unknown) => (typeof index === "number" ? sentUris[index] : undefined);
  return {
    ...rest,
    coverUri: uriAt(coverImage),
    steps: steps.map((step) => ({
      text: step.text,
      imageUris: (step.images ?? []).map(uriAt).filter((uri): uri is string => Boolean(uri)),
      videoAt: typeof step.videoAt === "number" ? step.videoAt : null,
    })),
  };
}

export function importRecipeFromText(text: string): Promise<ImportedDraft> {
  const trimmed = text.trim();
  if (trimmed.length < 10) {
    return Promise.reject(new ImportError("invalid_input", "内容太短了，至少把菜名和做法贴进来。"));
  }
  return invoke({ text: trimmed });
}

/** 小红书图床校验 Referer。 */
const XHS_REFERER = "https://www.xiaohongshu.com/";

/**
 * 远程图（从小红书链接读出来的）在手机上下载再转 base64：
 * 服务端在新加坡，访问国内 CDN 经常超时；手机就在国内网络里。
 */
async function remoteToBase64(uri: string, index: number): Promise<{ base64: string; mime: string } | null> {
  const target = `${FileSystem.cacheDirectory}xhs-import-${Date.now()}-${index}.img`;
  try {
    const result = await FileSystem.downloadAsync(uri, target, { headers: { Referer: XHS_REFERER } });
    if (result.status < 200 || result.status >= 300) return null;
    const type = (result.headers["Content-Type"] || result.headers["content-type"] || "").toLowerCase();
    const mime = type.includes("png") ? "image/png" : type.includes("webp") ? "image/webp" : "image/jpeg";
    const base64 = await FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64 });
    return { base64, mime };
  } catch {
    // 单张图下不下来不影响整体：正文和其它图照样解析。
    return null;
  } finally {
    FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  }
}

/**
 * 图文一起喂：小红书那种笔记，正文只写「先煎后焖」，**所有用量都在配方卡的图里**。
 * 只送文字会得到一份「看起来完全合法、但用量全空」的菜谱，不报错，比失败更难发现。
 *
 * `uris` 里 http(s) 开头的是从小红书链接读出来的远程图，在手机上带 Referer 下载；
 * 其余是本地截图。最后都以 base64 发给服务端。
 */
export async function importRecipeMixed(input: {
  text?: string;
  uris?: string[];
  importTicket?: string | null;
  sourceUrl?: string | null;
}): Promise<ImportedDraft> {
  const text = input.text?.trim() ?? "";
  const uris = input.uris ?? [];
  if (!text && !uris.length) {
    return Promise.reject(new ImportError("invalid_input", "至少贴一段文字或选一张截图。"));
  }
  if (text && text.length < 10 && !uris.length) {
    return Promise.reject(new ImportError("invalid_input", "内容太短了，至少把菜名和做法贴进来。"));
  }

  const images: { base64: string; mime: string }[] = [];
  const sentUris: string[] = [];
  let total = 0;
  for (const [index, uri] of uris.entries()) {
    let image: { base64: string; mime: string } | null;
    if (/^https?:\/\//i.test(uri)) {
      image = await remoteToBase64(uri, index);
      if (!image) continue;
    } else {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const lower = uri.toLowerCase();
      const mime = lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
      image = { base64, mime };
    }
    total += image.base64.length;
    if (total > MAX_TOTAL_CHARS) {
      throw new ImportError("image_too_large", "图片加起来太大了，少选几张再试。");
    }
    images.push(image);
    sentUris.push(uri);
  }
  if (!text && !images.length) {
    throw new ImportError("upstream", "笔记图片下载失败，稍后再试，或者先截图导入。");
  }
  return invoke({
    text: text || undefined,
    images: images.length ? images : undefined,
    importTicket: input.importTicket ?? undefined,
    sourceUrl: input.sourceUrl ?? undefined,
  }, sentUris);
}

export type XhsNote = {
  title: string;
  text: string;
  imageUrls: string[];
  isVideo: boolean;
  sourceUrl: string;
  /** 手机解析页面得到的视频地址，服务端不回传。 */
  videoUrl?: string | null;
};
export type XhsFetchResult = {
  note: XhsNote;
  /** 抓取已经扣过一次配额，30 分钟内凭它解析不再扣。 */
  importTicket: string;
  /** 视频笔记才有：`ticket` 用来轮询转写；`skipped` 说明为什么没转写。 */
  transcript: { ticket: string } | { skipped: string } | null;
};
export type TranscriptState =
  | { status: "running" }
  | { status: "done"; text: string }
  | { status: "failed"; reason: string };
type ServerTranscriptState = TranscriptState | { status: "ready"; url: string };

/** 百炼结果文件（阿里云 OSS 签名地址）由手机直接下：函数在新加坡，连北京 OSS 会超时。 */
const RESULT_TIMEOUT_MS = 15_000;

async function downloadTranscript(url: string): Promise<TranscriptState> {
  if (!/^https:\/\/[a-z0-9.-]+\.aliyuncs\.com\//i.test(url)) return { status: "failed", reason: "bad_result_url" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { status: "failed", reason: `result_${response.status}` };
    const text = transcriptText(await response.json());
    return text ? { status: "done", text } : { status: "failed", reason: "empty" };
  } catch {
    // 网络抖一下别判死：交回轮询，下一轮服务端会再给一次地址。
    return { status: "running" };
  } finally {
    clearTimeout(timer);
  }
}

/** 手机直连小红书一般 1~3 秒；给 15 秒。 */
const PAGE_TIMEOUT_MS = 15_000;
/** 服务端这一步只扣配额、签票、提交转写，很快。 */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * 用手机 Safari 的 UA：桌面 UA 会被 302 到 /login，微信 UA 会跳微信授权；
 * 手机浏览器拿到的是带 __INITIAL_STATE__ 的分享落地页（2026-11 实测）。
 */
const MOBILE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export function looksLikeXhsLink(input: string): boolean {
  return extractShareUrl(input) !== null;
}

/** 在手机上打开分享链接拿到笔记页 HTML。服务端在海外连不上小红书，只能手机来抓。 */
async function loadNotePage(url: URL): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        "User-Agent": MOBILE_SAFARI_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      signal: controller.signal,
    });
  } catch (problem) {
    if (problem instanceof Error && problem.name === "AbortError") {
      throw new ImportError("timeout", "读取小红书超时了，网络好的时候再试。");
    }
    throw new ImportError("offline", "连不上小红书，检查一下网络再试。");
  } finally {
    clearTimeout(timer);
  }

  // fetch 自动跟随跳转；落地页不在小红书域名、或者被带去登录页，都算读不了。
  let landed: URL | null = null;
  try {
    landed = response.url ? new URL(response.url) : null;
  } catch {
    landed = null;
  }
  if (landed && (!isAllowedHost(landed) || isLoginOrBlockedUrl(landed))) {
    throw new ImportError("fetch_blocked", fallbackMessage("fetch_blocked"));
  }
  if (response.status === 404 || landed?.pathname.startsWith("/404")) {
    throw new ImportError("note_unavailable", fallbackMessage("note_unavailable"));
  }
  if (!response.ok) {
    throw new ImportError("fetch_blocked", `${fallbackMessage("fetch_blocked")}（${response.status}）`);
  }
  return (await response.text()).slice(0, 3_000_000);
}

/**
 * 两步：手机抓页面并解析出正文 / 图片 / 视频地址，再交给服务端扣配额、签票、提交配音转写。
 * 解析失败不走服务端，也就不扣次数。
 */
export async function fetchXhsNote(input: string): Promise<XhsFetchResult> {
  const url = extractShareUrl(input.slice(0, 2000));
  if (!url) throw new ImportError("invalid_link", fallbackMessage("invalid_link"));

  const parsed = parseNotePage(await loadNotePage(url));
  if (parsed.kind === "unavailable") throw new ImportError("note_unavailable", fallbackMessage("note_unavailable"));
  if (parsed.kind === "blocked") throw new ImportError("fetch_blocked", fallbackMessage("fetch_blocked"));

  const { note } = parsed;
  const result = await callFunction<XhsFetchResult>(
    "fetch-xhs-note",
    {
      note: {
        title: note.title,
        text: noteToText(note),
        imageUrls: note.imageUrls,
        videoUrl: note.videoUrl,
        isVideo: note.isVideo,
        sourceUrl: url.toString(),
      },
    },
    FETCH_TIMEOUT_MS
  );
  return { ...result, note: { ...result.note, videoUrl: note.videoUrl } };
}

export async function checkTranscript(ticket: string): Promise<TranscriptState> {
  const payload = await callFunction<{ transcript?: ServerTranscriptState }>(
    "fetch-xhs-note",
    { transcriptTicket: ticket },
    FETCH_TIMEOUT_MS
  );
  const state = payload.transcript;
  if (!state) return { status: "failed", reason: "empty" };
  if (state.status === "ready") return await downloadTranscript(state.url);
  return state;
}

export const linkPlaceholder = "粘贴笔记正文，或者截图里能看清的做法";
export const TRANSCRIPT_PREFIX = "【视频配音】";
