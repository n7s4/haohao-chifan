/**
 * 小红书笔记 → 扣配额、签票、提交视频配音转写（第一段）。
 * 第二段仍是 import-recipe：用户核对回填内容后再点「开始解析」。
 *
 * 页面由手机抓、手机解析（共用 ./xhs.ts）：函数部署在新加坡，连小红书会超时（2026-11 实测）。
 *
 * 两种请求：
 * - `{ note }`：手机解析好的笔记。扣一次配额，返回 importTicket（凭票解析不再扣）；
 *   视频笔记顺手提交百炼转写，返回 transcriptTicket。
 * - `{ transcriptTicket }`：查转写进度，不扣配额。
 *
 * 部署：supabase functions deploy fetch-xhs-note
 * 秘钥：supabase secrets set DASHSCOPE_API_KEY=sk-xxx [DASHSCOPE_BASE_URL=...] [IMPORT_TICKET_SECRET=...]
 */
import { decodeSub, fail, json, CORS } from "../_shared/http.ts";
import { consumeQuota } from "../_shared/quota.ts";
import { signTicket, ticketSecret, verifyTicket } from "../_shared/ticket.ts";
import { queryTranscription, submitTranscription } from "./asr.ts";
import { isAllowedHost, MAX_IMAGES } from "./xhs.ts";

const TICKET_TTL_MS = 30 * 60 * 1000;
const MAX_TITLE = 200;
const MAX_TEXT = 20_000;

/** 只接受小红书 CDN 的地址：视频地址会交给百炼去下载，不能让人借它拉任意 URL。 */
function isXhsCdn(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "xhscdn.com" || host.endsWith(".xhscdn.com"));
  } catch {
    return false;
  }
}

type IncomingNote = {
  title: string;
  text: string;
  imageUrls: string[];
  videoUrl: string | null;
  isVideo: boolean;
  sourceUrl: string;
};

/** 手机送来的内容不可信：限长、限域名，不合法的字段丢掉而不是整单拒绝。 */
function readNote(raw: unknown): IncomingNote | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(String(value.sourceUrl ?? ""));
  } catch {
    return null;
  }
  if (!isAllowedHost(sourceUrl)) return null;
  const title = typeof value.title === "string" ? value.title.slice(0, MAX_TITLE) : "";
  const text = typeof value.text === "string" ? value.text.slice(0, MAX_TEXT) : "";
  const imageUrls = Array.isArray(value.imageUrls) ? value.imageUrls.filter(isXhsCdn).slice(0, MAX_IMAGES) : [];
  const videoUrl = isXhsCdn(value.videoUrl) ? value.videoUrl : null;
  if (!title && !text && !imageUrls.length) return null;
  return { title, text, imageUrls, videoUrl, isVideo: value.isVideo === true, sourceUrl: sourceUrl.toString() };
}

async function handleTranscript(ticket: unknown, userId: string): Promise<Response> {
  const secret = ticketSecret();
  const key = Deno.env.get("DASHSCOPE_API_KEY");
  if (!secret || !key) return fail("not_configured", "转写服务还没开通", 503);
  const payload = await verifyTicket(ticket, { kind: "asr", sub: userId }, secret);
  if (!payload || typeof payload.taskId !== "string") {
    return fail("invalid_input", "转写任务已过期，重新读取一次链接", 400);
  }
  const state = await queryTranscription(payload.taskId, key);
  if (state.status === "failed") console.warn("asr task failed", payload.taskId, state.reason);
  return json({ transcript: state });
}

async function handleNote(raw: unknown, auth: string, userId: string): Promise<Response> {
  const note = readNote(raw);
  if (!note) return fail("invalid_link", "这条笔记没读到内容，复制分享里的链接再试", 400);

  const secret = ticketSecret();
  if (!secret) return fail("not_configured", "服务端缺少签名密钥", 503);

  const quota = await consumeQuota(auth);
  if (quota === "unauthorized") return fail("session_expired", "登录状态已过期，重新登录后再试", 401);
  if (quota === "limited") return fail("rate_limited", "今天的解析次数用完了，明天再试", 429);

  const now = Date.now();
  const importTicket = await signTicket({ kind: "import", sub: userId, exp: now + TICKET_TTL_MS }, secret);

  let transcript: { ticket: string } | { skipped: string } | null = null;
  if (note.isVideo) {
    const key = Deno.env.get("DASHSCOPE_API_KEY");
    if (!key) transcript = { skipped: "not_configured" };
    else if (!note.videoUrl) transcript = { skipped: "no_video_url" };
    else {
      const taskId = await submitTranscription(note.videoUrl, key);
      transcript = taskId
        ? { ticket: await signTicket({ kind: "asr", sub: userId, exp: now + TICKET_TTL_MS, taskId }, secret) }
        : { skipped: "failed" };
    }
  }

  return json({
    note: {
      title: note.title,
      text: note.text,
      imageUrls: note.imageUrls,
      isVideo: note.isVideo,
      sourceUrl: note.sourceUrl,
    },
    importTicket,
    transcript,
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return fail("method_not_allowed", "只接受 POST", 405);

  const auth = request.headers.get("Authorization") ?? "";
  const userId = decodeSub(auth);
  if (!userId) return fail("session_expired", "登录状态已过期，重新登录后再试", 401);

  let payload: { note?: unknown; transcriptTicket?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("invalid_input", "请求体不是合法 JSON", 400);
  }

  if (payload.transcriptTicket !== undefined) return await handleTranscript(payload.transcriptTicket, userId);
  return await handleNote(payload.note, auth, userId);
});
