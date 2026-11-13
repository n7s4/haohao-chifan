/**
 * 阿里云百炼 Paraformer 录音文件识别（RESTful，异步）。
 *
 * 不用实时识别：实时要把音频切成 PCM 流推 WebSocket，函数里没有 ffmpeg 解不了视频。
 * 文件识别直接收 mp4 的公网 URL，百炼自己下载，我们只提交、查询两次 fetch。
 * 文档说处理「通常在数分钟内」，所以提交后立刻返回，由客户端轮询。
 */
import { transcriptText } from "./xhs.ts";

export { transcriptText };

export const DEFAULT_BASE = "https://dashscope.aliyuncs.com";

export function asrBase(): string {
  return (Deno.env.get("DASHSCOPE_BASE_URL") || DEFAULT_BASE).replace(/\/+$/, "");
}

export async function submitTranscription(fileUrl: string, apiKey: string, base = asrBase()): Promise<string | null> {
  try {
    const response = await fetch(`${base}/api/v1/services/audio/asr/transcription`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // 漏了这个头任务提交不上（文档原话）。
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "paraformer-v2",
        input: { file_urls: [fileUrl] },
        parameters: {
          channel_id: [0],
          language_hints: ["zh", "en"],
          // 口播里「嗯」「那个」很多，去掉后模型更容易抽到步骤。
          disfluency_removal_enabled: true,
        },
      }),
    });
    if (!response.ok) {
      console.warn("asr submit failed", response.status, (await response.text()).slice(0, 300));
      return null;
    }
    const body = await response.json();
    const taskId = body?.output?.task_id;
    return typeof taskId === "string" ? taskId : null;
  } catch (problem) {
    console.warn("asr submit threw", String(problem).slice(0, 200));
    return null;
  }
}

export type TranscriptState =
  | { status: "running" }
  | { status: "done"; text: string }
  /** 结果文件在北京 OSS，新加坡的函数常常拉不动：把签名地址交给手机自己下。 */
  | { status: "ready"; url: string }
  | { status: "failed"; reason: string };

/** 先在函数里试 4 秒；拉不到就让手机下（手机在国内，几百毫秒的事）。 */
const RESULT_FETCH_MS = 4000;

/**
 * 任务整体 SUCCEEDED 不代表文件成功：文档说只要有一个子任务成功就算 SUCCEEDED，
 * 下载失败会体现在 `results[i].subtask_status = FAILED` + `code`。所以逐个文件看。
 */
export function interpretTask(body: unknown): { state: "running" } | { state: "failed"; reason: string } | { state: "ready"; url: string } {
  const output = (body as { output?: Record<string, unknown> })?.output ?? {};
  const status = output.task_status;
  if (status === "PENDING" || status === "RUNNING") return { state: "running" };
  if (status !== "SUCCEEDED") {
    const code = typeof output.code === "string" ? output.code : String(status ?? "unknown");
    return { state: "failed", reason: code };
  }
  const results = Array.isArray(output.results) ? (output.results as Record<string, unknown>[]) : [];
  const ok = results.find((item) => item?.subtask_status === "SUCCEEDED" && typeof item.transcription_url === "string");
  if (ok) return { state: "ready", url: ok.transcription_url as string };
  const code = results.find((item) => typeof item?.code === "string")?.code;
  return { state: "failed", reason: typeof code === "string" ? code : "no_result" };
}

export async function queryTranscription(taskId: string, apiKey: string, base = asrBase()): Promise<TranscriptState> {
  try {
    // 中文文档的 Python 示例用 POST，英文文档和 cURL 用 GET；以 GET 为准。
    const response = await fetch(`${base}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      console.warn("asr query failed", response.status, (await response.text()).slice(0, 300));
      // 查询本身失败（限流、网络）别判死，让客户端下一轮再问。
      return response.status === 404 ? { status: "failed", reason: "task_not_found" } : { status: "running" };
    }
    const verdict = interpretTask(await response.json());
    if (verdict.state === "running") return { status: "running" };
    if (verdict.state === "failed") return { status: "failed", reason: verdict.reason };

    try {
      const result = await fetch(verdict.url, { signal: AbortSignal.timeout(RESULT_FETCH_MS) });
      if (result.ok) {
        const text = transcriptText(await result.json());
        return text ? { status: "done", text } : { status: "failed", reason: "empty" };
      }
      console.warn("asr result fetch status", result.status);
    } catch (problem) {
      console.warn("asr result fetch threw", String(problem).slice(0, 200));
    }
    return { status: "ready", url: verdict.url };
  } catch (problem) {
    console.warn("asr query threw", String(problem).slice(0, 200));
    return { status: "running" };
  }
}
