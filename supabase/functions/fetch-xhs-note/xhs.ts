/**
 * 小红书分享链接 / 笔记页 HTML → 正文、图片、视频地址。纯函数，不联网，方便单测。
 *
 * 页面结构随时会变，所以这里只认两条线索：
 * 1. `window.__INITIAL_STATE__`：不按固定路径取，而是在整棵树里找第一个
 *    同时有 `desc` 字符串和 `imageList` 数组的对象——桌面页、移动页路径不同，但这个形状一样。
 * 2. 退一步用 `og:*` meta，至少拿到标题、摘要和封面。
 */

const ALLOWED_HOSTS = ["xhslink.com", "xhslink.cn", "xiaohongshu.com"];

export function isAllowedHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  );
}

/**
 * 分享出来的往往是一整段「标题 + 链接 + 复制本条信息…」，从里面挑第一个小红书链接。
 * 只放行小红书域名：这个函数会替用户去抓页面，不能变成任意 URL 的代理。
 */
export function extractShareUrl(input: string): URL | null {
  const candidates = input.match(/https?:\/\/[^\s，。！？、）)】」"'<>]+/gi) ?? [];
  for (const raw of candidates) {
    try {
      const url = new URL(raw);
      if (isAllowedHost(url)) return url;
    } catch {
      // 不是合法 URL，看下一个
    }
  }
  return null;
}

export type ParsedNote = {
  title: string;
  text: string;
  imageUrls: string[];
  videoUrl: string | null;
  isVideo: boolean;
};

export type ParseResult =
  | { kind: "note"; note: ParsedNote }
  | { kind: "unavailable" }
  | { kind: "blocked" };

const UNAVAILABLE_MARKERS = ["当前笔记暂时无法浏览", "笔记不存在", "该笔记已被删除", "内容已无法查看"];

export function isLoginOrBlockedUrl(url: URL): boolean {
  return /login|captcha|verify|website-login|security/i.test(url.pathname);
}

function extractInitialState(html: string): unknown {
  const marker = html.indexOf("window.__INITIAL_STATE__");
  if (marker < 0) return null;
  const start = html.indexOf("=", marker);
  const end = html.indexOf("</script>", start);
  if (start < 0 || end < 0) return null;
  const raw = html
    .slice(start + 1, end)
    .trim()
    .replace(/;\s*$/, "")
    // 页面里是 JS 字面量不是 JSON：值位置上的 undefined 换成 null 才能 parse。
    .replace(/([:\[,]\s*)undefined(?=\s*[,}\]])/g, "$1null");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;

function findNoteObject(root: unknown, depth = 0): Json | null {
  if (!root || typeof root !== "object" || depth > 12) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findNoteObject(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const value = root as Json;
  if (typeof value.desc === "string" && Array.isArray(value.imageList)) return value;
  for (const child of Object.values(value)) {
    const found = findNoteObject(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function https(url: string): string {
  return url.replace(/^http:\/\//i, "https://");
}

function imageUrlOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Json;
  for (const key of ["urlDefault", "url", "urlPre"]) {
    if (typeof value[key] === "string" && value[key]) return https(value[key] as string);
  }
  if (Array.isArray(value.infoList)) {
    const infos = value.infoList as Json[];
    const preferred = infos.find((info) => info?.imageScene === "WB_DFT") ?? infos[0];
    if (typeof preferred?.url === "string") return https(preferred.url);
  }
  return null;
}

function videoUrlOf(note: Json): string | null {
  const video = note.video as Json | undefined;
  if (!video || typeof video !== "object") return null;
  const stream = ((video.media as Json | undefined)?.stream ?? {}) as Json;
  for (const codec of ["h264", "h265", "av1", "h266"]) {
    const list = stream[codec];
    if (Array.isArray(list)) {
      for (const entry of list as Json[]) {
        if (typeof entry?.masterUrl === "string" && entry.masterUrl) return https(entry.masterUrl);
        const backups = entry?.backupUrls;
        if (Array.isArray(backups) && typeof backups[0] === "string") return https(backups[0]);
      }
    }
  }
  const key = (video.consumer as Json | undefined)?.originVideoKey;
  if (typeof key === "string" && key) return `https://sns-video-bd.xhscdn.com/${key}`;
  return null;
}

/** `#家常菜[话题]#` → `#家常菜`，表情占位 `[笑哭R]` 删掉：都是噪音，还会被模型当成食材。 */
export function cleanDesc(desc: string): string {
  return desc
    .replace(/#([^#\[\]\n]+)\[话题\]#/g, "#$1")
    .replace(/\[[^\[\]\n]{1,8}R\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function meta(html: string, property: string): string[] {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property.replace(/[:.]/g, "\\$&")}["'][^>]*content=["']([^"']*)["']`,
    "gi",
  );
  return [...html.matchAll(pattern)].map((match) => decodeEntities(match[1]));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export const MAX_IMAGES = 9;

export function parseNotePage(html: string): ParseResult {
  if (UNAVAILABLE_MARKERS.some((marker) => html.includes(marker))) return { kind: "unavailable" };

  const note = findNoteObject(extractInitialState(html));
  if (note) {
    const videoUrl = videoUrlOf(note);
    const isVideo = note.type === "video" || Boolean(videoUrl);
    const imageUrls = (note.imageList as unknown[])
      .map(imageUrlOf)
      .filter((url): url is string => Boolean(url))
      .slice(0, MAX_IMAGES);
    return {
      kind: "note",
      note: {
        title: typeof note.title === "string" ? note.title.trim() : "",
        text: cleanDesc(note.desc as string),
        imageUrls,
        videoUrl,
        isVideo,
      },
    };
  }

  const title = meta(html, "og:title")[0] ?? "";
  const description = meta(html, "description")[0] ?? meta(html, "og:description")[0] ?? "";
  const images = meta(html, "og:image").map(https).slice(0, MAX_IMAGES);
  const videoUrl = meta(html, "og:video")[0] ?? null;
  // 只有 og 标签、而且连摘要都没有，基本就是登录墙或风控页：当成拿不到。
  if (!description && !videoUrl) return { kind: "blocked" };
  return {
    kind: "note",
    note: {
      title: title.replace(/\s*-\s*小红书\s*$/, "").trim(),
      text: cleanDesc(description),
      imageUrls: images,
      videoUrl: videoUrl ? https(videoUrl) : null,
      isVideo: Boolean(videoUrl),
    },
  };
}

/** 回填到「笔记文字」框的内容：标题单独一行，正文跟在后面。 */
export function noteToText(note: ParsedNote): string {
  const title = note.title && !note.text.startsWith(note.title) ? `${note.title}\n` : "";
  return `${title}${note.text}`.trim();
}

// ---------------------------------------------------------------- 配音转写结果
type Sentence = { begin_time?: unknown; text?: unknown };

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 百炼结果文件 → 文字。有逐句时间就每句一行「[分:秒] 句子」：
 * 解析时模型按这个时间给每一步标 `videoAt`，手机再从视频里截那一帧当步骤图。
 * 服务端和手机都用它（结果文件有时只能由手机下载）。
 */
export function transcriptText(result: unknown): string {
  const transcripts = (result as { transcripts?: { text?: unknown; sentences?: Sentence[] }[] })?.transcripts;
  if (!Array.isArray(transcripts)) return "";
  return transcripts
    .map((item) => {
      const sentences = Array.isArray(item?.sentences) ? item.sentences : [];
      const timed = sentences
        .map((sentence) => {
          const text = typeof sentence?.text === "string" ? sentence.text.trim() : "";
          if (!text) return "";
          return typeof sentence.begin_time === "number" ? `[${clock(sentence.begin_time)}] ${text}` : text;
        })
        .filter(Boolean);
      if (timed.length) return timed.join("\n");
      return typeof item?.text === "string" ? item.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}
