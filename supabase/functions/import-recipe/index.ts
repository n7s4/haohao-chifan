/**
 * 小红书笔记 / 抖音视频截图 / 纯文字 → 结构化菜谱草稿。
 *
 * 部署：supabase functions deploy import-recipe
 * 秘钥：supabase secrets set DEEPSEEK_API_KEY=sk-xxx [DEEPSEEK_MODEL=deepseek-flash]
 *
 * 客户端永远不直接调模型：API key 一旦进了 `EXPO_PUBLIC_*` 就是编译进 bundle 的，
 * 任何人解包都能拿走。这里用服务端 secret，客户端只带自己的 JWT。
 */
import { CORS, decodeSub, json } from "../_shared/http.ts";
import { consumeQuota, refundQuota } from "../_shared/quota.ts";
import { ticketSecret, verifyTicket } from "../_shared/ticket.ts";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
// 只有 Flash 收图片（v4-pro 不支持）；旧名 deepseek-chat / deepseek-v4-flash 也会转给 Flash，
// 但后者随时可能下线，所以默认写规范名。
const MODEL = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-flash";
const MAX_TEXT = 8000;
// 图文一起传时是**总量**：9 张各自合法、加起来撞上限的话，报出来的还是一条没头没脑的 413。
// 客户端压到 1600/0.8，一张 300~400KB base64，12MB 给足余量（上游内联上限是 48MiB）。
const MAX_TOTAL_CHARS = 12_000_000;
const MAX_IMAGES = 9;

type Draft = {
  name: string;
  minutes: number | null;
  ingredients: { name: string; qty: number | null; unit: string }[];
  seasonings: { name: string; qty: number | null; unit: string }[];
  /** 步骤配图：下标从 0 起，对应请求里 images 的顺序。 */
  /** `videoAt`：视频笔记里这一步画面的秒数（据配音时间戳），客户端按它截帧当步骤图。 */
  steps: { text: string; images: number[]; videoAt: number | null }[];
  /** 成品图下标，没有就 null。 */
  coverImage: number | null;
  sourceUrl: string | null;
};

const SYSTEM = `你是菜谱结构化助手。从用户给的文字或图片里抽取一道菜的菜谱，只输出 JSON，不要 Markdown、不要解释。

严格 schema：
{
  "name": string,              // 菜名，去掉「教程」「合集」这类词
  "minutes": number | null,    // 总时长（分钟），没有明确写就按步骤合理估算；完全看不出来给 null
  "ingredients": [{"name": string, "qty": number | null, "unit": string}],  // 主料
  "seasonings":  [{"name": string, "qty": number | null, "unit": string}],  // 调料（盐/生抽/糖…）
  "steps": [{"text": string, "images": number[], "videoAt": number | null}], // 按顺序，一步一句，去掉序号和表情；images 是这一步的配图编号；videoAt 见下
  "coverImage": number | null, // 成品图的编号
  "sourceUrl": string | null   // 原文里出现的链接，没有就 null
}

规则：
- 份量能确定的就给数字，单位用「克/毫升/个/勺/适量」这类中文单位；不确定的 qty 给 null、unit 给 "适量"。
- 图片里有菜名/用量就如实抽，看不清的别编。
- 多张图按上传顺序视为步骤先后；相邻几张内容重叠时合并成一步，别输出重复步骤。
- 图里明确标注的数量、时长**优先于**正文描述（很多笔记正文只写「先煎后焖」，用量全在配方卡的图里）。
- 正文和图都没有的字段就留空，别用常识补齐。
- 每张图前面有「【图N】」编号（N 从 1 开始）。没有图时 coverImage 给 null、images 给 []。
- coverImage：选**做好装盘的成品照片**（常标着「成品」）；没有成品照就给 null。不要选生食材、半成品或全是字的配方卡。
- steps[].images：填图片编号的数字数组，如 [2]。放**拍的就是这一步操作**的照片：
  图上标着「步骤N｜鸡翅划刀」这类字样的，按图上写的操作对应到你输出的那一步（你的步骤编号和图上的不一定一致）；
  一张拼图里有好几步时，放进它覆盖的第一步。只列食材的图、纯文字配方卡、成品图都不要放进步骤；
  对不上的步骤给 []。每张图最多用一次。除成品图和食材图外，尽量每张步骤照片都配上。
- 文字里「【视频配音】」后面每行开头的 [分:秒] 是视频里这句话开始说的时间。有这些时间时，给每一步填 videoAt：
  **这一步操作画面最清楚的那一秒**（整数秒）。一般取讲这一步的那句话开始后 2~4 秒、且不超过这句结束；
  一句话里讲了好几步时按先后在这句的时间范围内往后排开。没有时间戳的就全部给 null，别编。
- 不是菜谱（聊天、广告、纯风景）时输出 {"error":"not_recipe"}。
- 抽不到任何步骤时输出 {"error":"no_steps"}。`;

/** 小红书视频最长 15 分钟左右；再长的时间点肯定是模型编的。 */
const MAX_VIDEO_SECONDS = 60 * 60;

function normalise(raw: unknown, imageCount: number): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";

  // 模型给的是 1 起的编号；越界、重复、和封面撞了的一律丢掉，每张图只用一次。
  const used = new Set<number>();
  // 模型偶尔把编号写成 "2"、"图2"、"【图2】"，都认。
  const pick = (input: unknown): number | null => {
    const number =
      typeof input === "number" ? input : typeof input === "string" ? Number(input.match(/\d+/)?.[0]) : NaN;
    if (!Number.isInteger(number)) return null;
    const index = number - 1;
    if (index < 0 || index >= imageCount || used.has(index)) return null;
    used.add(index);
    return index;
  };
  const coverImage = pick(value.coverImage);

  const steps = Array.isArray(value.steps)
    ? value.steps
        .map((step) => {
          const item = (typeof step === "string" ? { text: step } : step ?? {}) as Record<string, unknown>;
          const text = typeof item.text === "string" ? item.text.trim() : "";
          if (!text) return null;
          const rawImages = item.images ?? item.image ?? item.imageIndexes;
          const list = Array.isArray(rawImages) ? rawImages : rawImages == null ? [] : [rawImages];
          const images = list.map(pick).filter((index): index is number => index !== null);
          const at = typeof item.videoAt === "string" ? Number(item.videoAt) : item.videoAt;
          const videoAt = typeof at === "number" && Number.isFinite(at) && at >= 0 && at <= MAX_VIDEO_SECONDS
            ? Math.round(at)
            : null;
          return { text, images, videoAt };
        })
        .filter((step): step is Draft["steps"][number] => Boolean(step))
    : [];
  if (!name || !steps.length) return null;

  const rows = (input: unknown) =>
    Array.isArray(input)
      ? input
          .map((item) => {
            const row = (item ?? {}) as Record<string, unknown>;
            const rowName = typeof row.name === "string" ? row.name.trim() : "";
            const qty = typeof row.qty === "number" && Number.isFinite(row.qty) ? row.qty : null;
            const unit = typeof row.unit === "string" ? row.unit.trim() : "";
            return rowName ? { name: rowName, qty, unit } : null;
          })
          .filter((row): row is { name: string; qty: number | null; unit: string } => Boolean(row))
      : [];

  const minutes =
    typeof value.minutes === "number" && Number.isFinite(value.minutes) && value.minutes > 0
      ? Math.round(value.minutes)
      : null;

  return {
    name,
    minutes,
    ingredients: rows(value.ingredients),
    seasonings: rows(value.seasonings),
    steps,
    coverImage,
    sourceUrl: typeof value.sourceUrl === "string" && value.sourceUrl.length > 0 ? value.sourceUrl : null,
  };
}

/** 只下载小红书图床：这个函数会替客户端去拉图，不能变成任意 URL 的代理。 */
function isXhsImageHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (host === "xhscdn.com" || host.endsWith(".xhscdn.com"));
}

const MAX_REMOTE_IMAGE_BYTES = 5_000_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 小红书图床校验 Referer，直接把 URL 交给模型多半拉不到，所以这里带上 Referer 下载转 base64。
 * 单张失败就跳过：正文和其它图还在，别因为一张图让整次解析失败。
 */
async function downloadImages(urls: string[]): Promise<{ base64: string; mime: string }[]> {
  const results = await Promise.all(
    urls.map(async (raw) => {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return null;
      }
      if (!isXhsImageHost(url)) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(url, {
          headers: { Referer: "https://www.xiaohongshu.com/", "User-Agent": "Mozilla/5.0" },
          signal: controller.signal,
        });
        if (!response.ok) {
          console.warn("image download failed", response.status, url.hostname);
          return null;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_REMOTE_IMAGE_BYTES) return null;
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
        const mime = type.startsWith("image/") ? type : "image/jpeg";
        return { base64: toBase64(bytes), mime };
      } catch (problem) {
        console.warn("image download threw", String(problem).slice(0, 200));
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return results.filter((item): item is { base64: string; mime: string } => Boolean(item));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "只接受 POST" } }, 405);

  const auth = request.headers.get("Authorization") ?? "";
  const userId = decodeSub(auth);
  if (!userId) {
    return json({ error: { code: "session_expired", message: "登录状态已过期，重新登录后再试" } }, 401);
  }

  const key = Deno.env.get("DEEPSEEK_API_KEY");
  if (!key) {
    return json({ error: { code: "not_configured", message: "服务端还没有配置 DEEPSEEK_API_KEY" } }, 503);
  }

  let payload: {
    text?: string;
    image?: string;
    imageMime?: string;
    images?: { base64?: string; mime?: string }[];
    imageUrls?: unknown;
    importTicket?: unknown;
    sourceUrl?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return json({ error: { code: "invalid_input", message: "请求体不是合法 JSON" } }, 400);
  }

  const text = (payload.text ?? "").trim().slice(0, MAX_TEXT);
  // 兼容早期的单图字段：老客户端还在线上，不能因为字段改名就把它们的请求判成非法。
  const incoming = Array.isArray(payload.images)
    ? payload.images
    : payload.image
      ? [{ base64: payload.image, mime: payload.imageMime }]
      : [];
  const images = incoming
    .map((item) => ({
      base64: typeof item?.base64 === "string" ? item.base64 : "",
      mime: typeof item?.mime === "string" && item.mime ? item.mime : "image/jpeg",
    }))
    .filter((item) => item.base64.length > 0);
  // 从小红书链接读出来的图：客户端只有 URL，由这里下载。
  const imageUrls = Array.isArray(payload.imageUrls)
    ? payload.imageUrls.filter((item): item is string => typeof item === "string" && item.length < 2000)
    : [];
  const sourceUrl =
    typeof payload.sourceUrl === "string" && /^https?:\/\//i.test(payload.sourceUrl) && payload.sourceUrl.length < 2000
      ? payload.sourceUrl
      : null;

  if (!text && !images.length && !imageUrls.length) {
    return json({ error: { code: "invalid_input", message: "至少给一段文字或一张图" } }, 400);
  }
  if (images.length + imageUrls.length > MAX_IMAGES) {
    return json({ error: { code: "image_too_large", message: `截图最多 ${MAX_IMAGES} 张` } }, 413);
  }

  // 凭抓取链接时拿到的票解析：那一步已经扣过次数，这里不再扣，失败也就不用退。
  const secret = ticketSecret();
  const prepaid = Boolean(
    secret && payload.importTicket && (await verifyTicket(payload.importTicket, { kind: "import", sub: userId }, secret)),
  );

  if (imageUrls.length) {
    images.push(...(await downloadImages(imageUrls)));
    if (!text && !images.length) {
      return json({ error: { code: "invalid_input", message: "笔记图片没下载下来，把正文贴进来再试" } }, 422);
    }
  }
  const totalChars = images.reduce((sum, item) => sum + item.base64.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return json({ error: { code: "image_too_large", message: "截图加起来太大了，少选几张再试" } }, 413);
  }

  if (!prepaid) {
    const quota = await consumeQuota(auth);
    if (quota === "unauthorized") {
      return json({ error: { code: "session_expired", message: "登录状态已过期，重新登录后再试" } }, 401);
    }
    if (quota === "limited") {
      return json({ error: { code: "rate_limited", message: "今天的解析次数用完了，明天再试" } }, 429);
    }
  }

  const respond = async (): Promise<Response> => {
    const content: Record<string, unknown>[] = [];
    if (text) content.push({ type: "text", text });
    for (const [index, item] of images.entries()) {
      // 编号让模型能说出「哪张是成品、哪张配哪一步」。
      content.push({ type: "text", text: `【图${index + 1}】` });
      content.push({ type: "image_url", image_url: { url: `data:${item.mime};base64,${item.base64}` } });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          // 思考模式默认开、effort=high：菜谱抽取用不上，只会顶爆 55s 超时并翻倍 token。
          thinking: { type: "disabled" },
          // 长菜谱（20 来步 + 十几种调料）容易被默认上限截断，截断就是 JSON.parse 失败，
          // 用户看到的是「没认出这是一份菜谱」，很难看出真正原因。
          max_tokens: 4000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content },
          ],
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        console.error("deepseek failed", response.status, detail.slice(0, 400));
        if (response.status === 401 || response.status === 403) {
          return json({ error: { code: "upstream_auth", message: "解析服务的 key 无效，找管理员换一下" } }, 502);
        }
        if (response.status === 400 && images.length > 0) {
          return json(
            { error: { code: "invalid_input", message: "这个模型没接受图片，先用「粘贴文字」把做法贴进来" } },
            422
          );
        }
        return json({ error: { code: "upstream", message: "解析服务暂时不可用，稍后再试" } }, 502);
      }

      const body = await response.json();
      const raw = body?.choices?.[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof raw === "string" ? raw : "{}");
      } catch {
        return json({ error: { code: "bad_model_output", message: "没认出这是一份菜谱，试试换一段更完整的文字" } }, 422);
      }

      const marker = (parsed as { error?: string })?.error;
      if (marker === "not_recipe") {
        return json({ error: { code: "not_recipe", message: "这段内容看着不像菜谱" } }, 422);
      }
      if (marker === "no_steps") {
        return json({ error: { code: "no_steps", message: "只找到食材，没找到做法步骤" } }, 422);
      }

      const draft = normalise(parsed, images.length);
      if (images.length) {
        // 只记编号，方便排查「图配错了」；不记正文。
        const rawSteps = (parsed as { steps?: { images?: unknown }[] })?.steps;
        console.log("image assignment", JSON.stringify({
          count: images.length,
          rawCover: (parsed as { coverImage?: unknown })?.coverImage,
          rawSteps: Array.isArray(rawSteps) ? rawSteps.map((step) => step?.images) : null,
          cover: draft?.coverImage,
          steps: draft?.steps.map((step) => step.images),
        }));
      }
      if (!draft) {
        return json({ error: { code: "not_recipe", message: "没认出菜名或步骤，试试补一句做法" } }, 422);
      }
      if (!draft.sourceUrl && sourceUrl) draft.sourceUrl = sourceUrl;
      return json({ draft });
    } catch (problem) {
      const aborted = problem instanceof Error && problem.name === "AbortError";
      return json(
        { error: { code: aborted ? "timeout" : "upstream", message: aborted ? "解析超时了，再试一次" : "解析服务出错了" } },
        aborted ? 504 : 502
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  const result = await respond();
  // 只有「真出了草稿」才算一次；4xx/5xx 全部退还。限流判断本身（429/401）
  // 在 respond 外面，不会走到这里。
  if (!prepaid && result.status >= 400) await refundQuota(userId);
  return result;
});
