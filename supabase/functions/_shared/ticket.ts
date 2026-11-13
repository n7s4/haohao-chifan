/**
 * 服务端签发、服务端校验的小票据：`base64url(payload).base64url(hmac)`。
 *
 * 两个用途：
 * - importTicket：抓取笔记已经扣过一次配额，凭票在有效期内解析不再重复扣。
 * - transcriptTicket：把百炼的 task id 和用户绑在一起，别人拿不到也查不了。
 *
 * 不用 JWT 库：只需要 HMAC-SHA256，WebCrypto 自带，少一个依赖少一处升级。
 */
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const pad = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function ticketSecret(): string | null {
  return Deno.env.get("IMPORT_TICKET_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

export type TicketPayload = { kind: string; sub: string; exp: number; [key: string]: unknown };

export async function signTicket(payload: TicketPayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** 签名不对、过期、类型或用户不匹配一律返回 null：调用方只关心「能不能用」。 */
export async function verifyTicket(
  ticket: unknown,
  expect: { kind: string; sub: string },
  secret: string,
  now = Date.now(),
): Promise<TicketPayload | null> {
  if (typeof ticket !== "string") return null;
  const [body, signature] = ticket.split(".");
  if (!body || !signature) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64Url(signature),
      encoder.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as TicketPayload;
    if (payload.kind !== expect.kind || payload.sub !== expect.sub) return null;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
