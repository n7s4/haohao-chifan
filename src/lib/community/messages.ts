/**
 * 私信 / 群聊的数据访问层。和 api.ts 一样：第一个参数是注入的 SupabaseClient，返回 Result，
 * 不碰 react-native / expo，可在 Deno 集成测试里跑。
 * 业务拒绝都是 P0001 + message，按 dbReason 映射；其余错误走 reasonOf。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AnyError, fail, ok, okVoid, reasonOf, type Result } from "./api";
import { type ChatMessage, dbReason } from "./messagesLogic";

export const MESSAGES_PAGE = 40;

export type ConversationSummary = {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  lastMessageAt: string;
  lastBody: string | null;
  lastSenderId: string | null;
  unread: number;
  peerId: string | null;
  memberCount: number;
};
export type ConversationInfo = { id: string; kind: "direct" | "group"; name: string | null; ownerId: string | null };
export type MemberEntry = { userId: string; role: "owner" | "member"; joinedAt: string };

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

const failure = <T>(error: AnyError, status?: number): Result<T> =>
  fail(error.code === "P0001" ? (dbReason(error.message) ?? "invalid") : reasonOf(error, status));

function rowToMessage(r: Row): ChatMessage {
  return {
    id: str(r.id),
    conversationId: str(r.conversation_id),
    senderId: strOrNull(r.sender_id),
    body: str(r.body),
    createdAt: str(r.created_at),
  };
}

const MESSAGE_COLS = "id, conversation_id, sender_id, body, created_at";

async function callVoid(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Result<void>> {
  const { error, status } = await client.rpc(fn, args);
  return error ? failure(error, status) : okVoid;
}

export async function openDirect(client: SupabaseClient, target: string): Promise<Result<string>> {
  const { data, error, status } = await client.rpc("open_direct", { target });
  if (error) return failure(error, status);
  return typeof data === "string" ? ok(data) : fail("unavailable");
}

export async function listConversations(client: SupabaseClient): Promise<Result<ConversationSummary[]>> {
  const { data, error, status } = await client.rpc("my_conversations");
  if (error) return failure(error, status);
  return ok((Array.isArray(data) ? data : []).map((r: Row): ConversationSummary => ({
    id: str(r.id),
    kind: r.kind === "group" ? "group" : "direct",
    name: strOrNull(r.name),
    lastMessageAt: str(r.last_message_at),
    lastBody: strOrNull(r.last_body),
    lastSenderId: strOrNull(r.last_sender_id),
    unread: Number(r.unread) || 0,
    peerId: strOrNull(r.peer_id),
    memberCount: Number(r.member_count) || 0,
  })));
}

export async function getConversation(client: SupabaseClient, id: string): Promise<Result<ConversationInfo>> {
  const { data, error, status } = await client.from("conversations").select("id, kind, name, owner_id")
    .eq("id", id).maybeSingle();
  if (error) return failure(error, status);
  if (!data) return fail("unavailable");
  return ok({
    id: str(data.id),
    kind: data.kind === "group" ? "group" : "direct",
    name: strOrNull(data.name),
    ownerId: strOrNull(data.owner_id),
  });
}

export async function listMembers(client: SupabaseClient, id: string): Promise<Result<MemberEntry[]>> {
  const { data, error, status } = await client.from("conversation_members").select("user_id, role, joined_at")
    .eq("conversation_id", id).order("joined_at", { ascending: true }).order("user_id", { ascending: true });
  if (error) return failure(error, status);
  return ok((data ?? []).map((r: Row): MemberEntry => ({
    userId: str(r.user_id),
    role: r.role === "owner" ? "owner" : "member",
    joinedAt: str(r.joined_at),
  })));
}

/** 最新的一页（或 before 之前的一页），按 (created_at, id) 倒序取，返回升序。 */
export async function listMessages(
  client: SupabaseClient,
  id: string,
  before?: { createdAt: string; id: string },
): Promise<Result<ChatMessage[]>> {
  let q = client.from("messages").select(MESSAGE_COLS).eq("conversation_id", id);
  if (before) {
    q = q.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);
  }
  const { data, error, status } = await q.order("created_at", { ascending: false })
    .order("id", { ascending: false }).limit(MESSAGES_PAGE);
  if (error) return failure(error, status);
  return ok((data ?? []).map(rowToMessage).reverse());
}

export async function sendMessage(
  client: SupabaseClient,
  me: string,
  id: string,
  body: string,
): Promise<Result<ChatMessage>> {
  const { data, error, status } = await client.from("messages")
    .insert({ conversation_id: id, sender_id: me, body }).select(MESSAGE_COLS).single();
  if (error) return failure(error, status);
  return data ? ok(rowToMessage(data)) : fail("unavailable");
}

export const markRead = (client: SupabaseClient, id: string) => callVoid(client, "mark_read", { conv: id });

export async function createGroup(client: SupabaseClient, name: string, ids: string[]): Promise<Result<string>> {
  const { data, error, status } = await client.rpc("create_group", { group_name: name, member_ids: ids });
  if (error) return failure(error, status);
  return typeof data === "string" ? ok(data) : fail("unavailable");
}

export const inviteMembers = (client: SupabaseClient, id: string, ids: string[]) =>
  callVoid(client, "invite_members", { conv: id, member_ids: ids });

export const renameGroup = (client: SupabaseClient, id: string, name: string) =>
  callVoid(client, "rename_group", { conv: id, group_name: name });

export const removeMember = (client: SupabaseClient, id: string, member: string) =>
  callVoid(client, "remove_member", { conv: id, member });

export const leaveConversation = (client: SupabaseClient, id: string) =>
  callVoid(client, "leave_conversation", { conv: id });

/** 互相关注的人：我关注的 ∩ 关注我的。 */
export async function listMutuals(client: SupabaseClient, me: string): Promise<Result<string[]>> {
  const [mine, theirs] = await Promise.all([
    client.from("follows").select("followee_id").eq("follower_id", me),
    client.from("follows").select("follower_id").eq("followee_id", me),
  ]);
  if (mine.error) return failure(mine.error, mine.status);
  if (theirs.error) return failure(theirs.error, theirs.status);
  const fans = new Set((theirs.data ?? []).map((r) => String(r.follower_id)));
  return ok((mine.data ?? []).map((r) => String(r.followee_id)).filter((id) => fans.has(id)));
}

/** 订阅 messages 的 INSERT（RLS 只放行我所在会话的消息）；onStatus 可选，收到 SUBSCRIBED 等状态；返回取消订阅函数。 */
export function subscribeMessages(
  client: SupabaseClient,
  filter: { conversationId?: string },
  onInsert: (m: ChatMessage) => void,
  onStatus?: (status: string) => void,
): () => void {
  const channel = client.channel(`messages-${filter.conversationId ?? "all"}-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        ...(filter.conversationId ? { filter: `conversation_id=eq.${filter.conversationId}` } : {}),
      },
      (payload) => onInsert(rowToMessage(payload.new as Row)),
    )
    .subscribe(onStatus ? (status) => onStatus(status) : undefined);
  return () => {
    void client.removeChannel(channel);
  };
}
