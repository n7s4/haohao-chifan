# 第二期：私信和私人群聊 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户之间可以私信（对陌生人有 1 条限制、被拉黑发不出去），能把互关的人拉进最多 50 人的私人群聊，消息实时出现，有未读红点。

**Architecture:** 新迁移 010 加 conversations / conversation_members / messages 三张表；读权限靠 RLS（成员判断用 security definer 的 `is_conversation_member`，避免策略递归），所有写操作除「发消息」外都走 security definer RPC，规则写在 RPC 和触发器里，用 pgTAP 测。客户端新增 `messages.ts`（Result 风格，同 social.ts）和纯逻辑 `messagesLogic.ts`；实时用 supabase-js 自带的 Realtime（postgres_changes，受 RLS 约束），不加依赖。

**Tech Stack:** Expo SDK 58 / expo-router / Reanimated 4 / react-native-keyboard-controller（已装）/ TypeScript strict / Supabase (Postgres, RLS, Realtime, pgTAP) / Deno 单测

**Spec:** `docs/superpowers/specs/2026-11-20-social-follow-messages-design.md`（第二期部分）

## Global Constraints

- 只走 OTA：不加依赖、不改 package.json（含 scripts）。发 OTA 前先 `expo export` 并 grep 确认包里有 Supabase 项目地址，再 `--skip-bundler` 发布。
- 所有消息功能需要登录；游客点「私信」走 `/sign-in`。
- 规则在数据库强制，不能只靠客户端；每条规则 pgTAP 正反两面。
- 统一提示文案（逐字）：
  - 被拉黑方发私信 / 开私信：「对方暂时无法接收消息」（不说明原因）
  - 陌生人限制：「对方回复或关注你之前，只能发送 1 条消息」
  - 频率超限：「发得太快了，歇一会儿再发」
  - 群满：「群里已经满 50 人了」
- 消息正文：去掉首尾空白后 1–1000 字，纯文字。
- 群人数上限 50（含群主）；发消息每人每分钟 30 条（跨所有会话）。
- 只做 App 内消息列表、红点；不做系统推送、已读回执、撤回、复制、图片。
- 生产库迁移先问用户。测试跑完 `git checkout -- deno.lock`。OrbStack 只在跑测试时开，测完 `supabase stop` 并退出。
- 面向用户的文案用简体中文。

## 数据库错误约定（Task 1/2 产出，Task 3 消费）

所有业务拒绝都 `raise exception '<code>' using errcode = 'P0001'`，客户端按 message 映射：

| message | 何时 | 客户端 reason |
|---|---|---|
| `recipient_unavailable` | 私信会话里任一方拉黑了另一方（开私信或发消息） | `unavailable` |
| `stranger_limit` | 陌生人限制 | `stranger_limit` |
| `rate_limited` | 1 分钟内已发 30 条 | `rate_limited` |
| `group_full` | 群成员会超过 50 | `group_full` |
| `not_mutual` | 邀请 / 建群的人不是互关或有拉黑 | `not_mutual` |
| `forbidden` | 非成员 / 非群主操作 | `auth` |
| `invalid` | 参数不合法（群名、人数不足、对自己开私信等） | `invalid` |

## Review Focus

1. 自己刚发的消息既有乐观插入又会收到 Realtime 推送：不能出现两条。（Task 3 `mergeMessages` 单测按 id 去重）
2. 群里有被我拉黑的人：我看不到 Ta 的消息，未读数和列表预览也不算 Ta 的消息；私信会话里拉黑后历史仍可看。（Task 1 `my_conversations` pgTAP；Task 5 客户端过滤）
3. 群主退群：群主转给最早入群的成员；最后一人退出会话被删除。账号删除时同样处理。（Task 2 pgTAP，触发器统一处理）
4. 两个人同时第一次给对方开私信：只产生一个会话。（Task 1：`direct_key` 唯一约束 + on conflict，pgTAP 重复调用返回同一 id）
5. 聊天页从后台回来 / Realtime 断线期间漏掉的消息：回到前台时补拉最新一页。（Task 5）

---

### Task 1: 迁移 010（会话、成员、消息、私信规则）+ pgTAP

**Files:**
- Create: `supabase/migrations/010_messages.sql`
- Create: `supabase/tests/messages_test.sql`

**Interfaces — Produces:**
- `conversations(id uuid pk default gen_random_uuid(), kind text check in ('direct','group'), name text null, owner_id uuid null references auth.users on delete set null, direct_key text unique null, created_at timestamptz default now(), last_message_at timestamptz default now())`。check：direct 时 `name is null and direct_key is not null`；group 时 `direct_key is null and char_length(btrim(name)) between 1 and 30`。`direct_key = least(a,b)::text || ':' || greatest(a,b)::text`。
- `conversation_members(conversation_id uuid references conversations on delete cascade, user_id uuid references auth.users on delete cascade, role text check in ('owner','member') default 'member', joined_at timestamptz default now(), last_read_at timestamptz default now(), pk(conversation_id, user_id))`；索引 `(user_id)`。
- `messages(id uuid pk default gen_random_uuid(), conversation_id uuid references conversations on delete cascade, sender_id uuid null references auth.users on delete set null, body text check char_length(btrim(body)) between 1 and 1000, created_at timestamptz default now())`；索引 `(conversation_id, created_at desc)`、`(sender_id, created_at desc)`。
- `is_conversation_member(conv uuid) returns boolean`：stable、security definer、只授权 authenticated。
- RLS：三张表 select 都是 `is_conversation_member(…)`；messages insert `with check (sender_id = auth.uid() and is_conversation_member(conversation_id))`；其他 insert/update/delete 全部不给（revoke insert, update, delete on conversations, conversation_members；revoke update, delete on messages）。anon 全部不可见。
- messages before insert 触发器（security definer）按顺序：
  1. 频率：同一 sender 在 `now() - interval '1 minute'` 之后 ≥ 30 条 → `rate_limited`。
  2. 若会话是 direct，对方 = 另一成员：
     - 任一方向有 blocks → `recipient_unavailable`；
     - 对方在本会话发过消息 → 放行；
     - 否则对方当前关注发送者 → 放行；
     - 否则发送者在本会话已有 ≥ 1 条 → `stranger_limit`。
- messages after insert 触发器：`update conversations set last_message_at = new.created_at`。
- RPC（security definer，`set search_path = public, pg_temp`，revoke from public/anon，grant authenticated）：
  - `open_direct(target uuid) returns uuid`：未登录 / target = 自己 → `invalid`；任一方向拉黑 → `recipient_unavailable`；按 direct_key 找到就返回；否则插入会话（`on conflict (direct_key) do nothing` 后再查）和两个 member 行（role 都是 member，owner_id 为 null）。不要求关注。
  - `mark_read(conv uuid) returns void`：把自己的 last_read_at 设为 now()；非成员 → `forbidden`。
  - `my_conversations() returns table(id uuid, kind text, name text, last_message_at timestamptz, last_body text, last_sender_id uuid, unread int, peer_id uuid, member_count int)`：security invoker，按 last_message_at desc。
    - unread = 晚于我的 last_read_at、sender 不是我的消息数。
    - last_body / last_sender_id = 最新一条消息，没有消息时为 null。
    - peer_id 只对 direct 有值。
    - **group 会话里我拉黑的人发的消息不计入 unread，也不作为预览**；direct 不排除。
- `alter publication supabase_realtime add table` 三张表（用 DO 块先查 `pg_publication_tables`，可重复执行）。

- [ ] **Step 1：写 pgTAP**（用户 A、B、C）。至少：
  - 三表存在；anon 读 messages 为 0。
  - A `open_direct(B)` 得到 id；B `open_direct(A)` 返回同一 id；`open_direct(A)` 自己 → P0001 invalid。
  - C 读不到 A–B 会话和消息；C 往 A–B 会话插消息 → 42501。
  - A 冒充 B 的 sender_id → 42501；空白正文、1001 字 → 23514。
  - 陌生人：B 未关注 A，A 发第 1 条成功、第 2 条 `stranger_limit`；B 关注 A 后 A 能发；B 取关后 A 又被限制；B 回复一条后取关，A 仍能发。A 关注 B 不影响 A 的限制。
  - 拉黑：A 拉黑 B → B 发 `recipient_unavailable`、A 发也被拒、B `open_direct(A)` 被拒；A 仍能读历史；解除后 B 能发。
  - 频率：A 在 1 分钟内第 31 条 `rate_limited`（测试里先用 superuser 直接插 30 条带当前时间的消息，再以 A 的身份插第 31 条）。
  - last_message_at 随新消息更新；`mark_read` 后 unread 为 0；`my_conversations` 对 B 的 unread 等于 A 发来的条数、peer_id = A。
  - 直接 insert conversations / conversation_members → 42501；update messages → 42501。
  - 三表都在 supabase_realtime publication 里。
- [ ] **Step 2：**开 OrbStack，`supabase start && supabase db reset && supabase test db` → 新文件失败（表不存在）。
- [ ] **Step 3：**写迁移（风格照 009）。
- [ ] **Step 4：**`supabase db reset && supabase test db` → 全部通过（含原有 135 个）。
- [ ] **Step 5：**提交。

### Task 2: 群聊规则 + 举报消息（追加到 010）+ pgTAP

**Files:**
- Modify: `supabase/migrations/010_messages.sql`
- Modify: `supabase/tests/messages_test.sql`

**Interfaces — Produces:**
- `is_mutual(a uuid, b uuid) returns boolean`（内部用，不授权给客户端）：双向 follows 都在，且任一方向没有 blocks。
- `create_group(group_name text, member_ids uuid[]) returns uuid`：
  - 去重、去掉自己后至少 2 人，否则 `invalid`；
  - 每人都与调用者 is_mutual，否则 `not_mutual`；
  - 总人数（含自己）> 50 → `group_full`；
  - 调用者 role owner，并写 conversations.owner_id。
- `invite_members(conv uuid, member_ids uuid[]) returns void`：
  - 只有 group 成员能调，否则 `forbidden`；
  - 每个被邀请人都要和调用者 is_mutual，否则 `not_mutual`；
  - 已在群里的人跳过；
  - 会超过 50 → `group_full`，整批不加。
- `rename_group(conv uuid, group_name text) returns void`：只有群主，否则 `forbidden`；名字规则同建群，不合法 → `invalid`。
- `remove_member(conv uuid, member uuid) returns void`：只有群主，否则 `forbidden`；不能移除自己（`invalid`）。
- `leave_conversation(conv uuid) returns void`：只对 group 有效，direct → `invalid`；删除自己的成员行。
- conversation_members after delete 触发器（security definer）：
  - 删的是 owner 且会话还有成员 → 把 joined_at 最早（同时间按 user_id）的成员升为 owner，并同步 owner_id；
  - 会话已没有成员 → 删除会话。
  - 账号删除级联时走同一条路径。
- conversation_members before insert 触发器：group 成员数已到 50 → `group_full`（兜底；RPC 里已检查）。
- `community_reports`：
  - 新增 `message_id uuid references messages on delete cascade` 和 `message_body text`（快照）；
  - one_target 改为四选一（`num_nonnulls(community_recipe_id, comment_id, reported_user_id, message_id) = 1`）；
  - 唯一索引改为 `coalesce` 四列；
  - before insert 触发器（security definer）在 message_id 非空时：
    - 举报人必须是该会话成员、消息不是自己发的，否则 `forbidden`；
    - 把 `message_body` 设为消息正文（忽略客户端传值）。

- [ ] **Step 1：写 pgTAP**（A、B、C、D）。至少：
  - A 与 B、C 互关，与 D 不互关。
  - `create_group` 只选 B → invalid；选 B、D → not_mutual；选 B、C 成功，A 是 owner。
  - B 邀请 D（B 与 D 互关后才成功；否则 not_mutual）；A 拉黑 D 后 A、D 互相邀请都被拒。
  - 邀请已在群里的人不报错也不重复。
  - 成员能读群消息、能发言；非成员不能。
  - B 改群名 → forbidden；A 改成功；空名 / 31 字 → invalid。
  - B 移除 C → forbidden；A 移除 C 成功，C 读不到群。
  - A 退群 → owner 变为最早入群的 B，owner_id 同步；最后一人退出后会话不存在。
  - direct 会话 `leave_conversation` → invalid。
  - 第 51 人加入 → group_full（直接构造 49 个 auth 用户 + 互关数据，或以 superuser 插成员后调 invite）。
  - 删除 auth.users 里的群主 → 群主转移；该用户的消息保留且 sender_id 为 null。
  - 举报消息：成员举报别人的消息成功，message_body 等于原文；重复举报 23505；举报自己的消息 → forbidden；非成员举报 → forbidden。
  - 群里有 A 拉黑的 B：A 的 `my_conversations` unread 不计 B 的消息、预览不是 B 的消息；同一群对 C 照常计入。
- [ ] **Step 2：**`supabase db reset && supabase test db` → 新增断言失败。
- [ ] **Step 3：**实现。
- [ ] **Step 4：**全部通过。
- [ ] **Step 5：**提交。

### Task 3: 数据访问层与纯逻辑

**Files:**
- Create: `src/lib/community/messages.ts`、`src/lib/community/messagesLogic.ts`、`src/lib/community/messagesLogic_test.ts`
- Modify: `src/lib/community/api.ts`
  - `FailReason` 增加 `"stranger_limit" | "rate_limited" | "group_full" | "not_mutual"`；
  - `report` 的 target 增加 `{ messageId: string }`。
- Modify: `src/lib/community/useCommunityProfile.tsx`（`failMessage` 覆盖新 reason，文案见 Global Constraints；not_mutual →「只能邀请互相关注的人」）
- Modify: `src/lib/community/api_test.ts`（集成流程）

**Interfaces — Produces:**
- `messagesLogic.ts`：
  - `type ChatMessage = { id: string; conversationId: string; senderId: string | null; body: string; createdAt: string; pending?: boolean; failed?: boolean }`
  - `mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[]`：按 id 去重（incoming 覆盖，去掉同 id 的 pending），按 createdAt 升序、同时间按 id。
  - `validateBody(text: string): string | null`：trim 后 1–1000 字返回 trim 结果，否则 null。
  - `dbReason(message: string | undefined): FailReason | null`：把上表 message 映射为 reason；未知返回 null。
  - `strangerHint(o: { kind: "direct" | "group"; peerFollowsMe: boolean; peerHasSent: boolean; mySent: number }): boolean`：direct 且对方没发过、没关注我、我已发 ≥ 1 → true。
  - `formatChatTime(iso: string, now: Date): string`：
    - 今天 →「HH:mm」；
    - 昨天 →「昨天 HH:mm」；
    - 今年 →「M月D日」；
    - 更早 →「YYYY/M/D」。
  - `totalUnread(list: { unread: number }[]): number`；`badgeText(n: number): string`（> 99 显示「99+」）。
- `messages.ts`（第一个参数是 SupabaseClient，返回 Result）：
  - `openDirect(client, target): Result<string>`
  - `listConversations(client): Result<ConversationSummary[]>`（调 my_conversations；`ConversationSummary` 字段为 camelCase 版的 RPC 列）
  - `getConversation(client, id): Result<{ id; kind; name: string | null; ownerId: string | null }>`
  - `listMembers(client, id): Result<{ userId: string; role: "owner" | "member"; joinedAt: string }[]>`
  - `listMessages(client, id, before?: { createdAt: string; id: string }): Result<ChatMessage[]>`：每页 `MESSAGES_PAGE = 40`，按 (created_at, id) 倒序取、返回升序；before 用 `or=(created_at.lt.X,and(created_at.eq.X,id.lt.Y))`。
  - `sendMessage(client, me, id, body): Result<ChatMessage>`（insert … select 返回整行）
  - `markRead`、`createGroup(client, name, ids): Result<string>`、`inviteMembers`、`renameGroup`、`removeMember`、`leaveConversation`：Result<void>。
  - `listMutuals(client, me): Result<string[]>`：我关注的 ∩ 关注我的。
  - `subscribeMessages(client, filter: { conversationId?: string }, onInsert: (m: ChatMessage) => void): () => void`：建 channel，订阅 messages INSERT；给 conversationId 时加 `conversation_id=eq.` 过滤；返回取消订阅函数（removeChannel）。
  - 错误统一：P0001 → `dbReason(error.message) ?? "invalid"`，其余走 reasonOf。

- [ ] **Step 1：**写 Deno 单测：
  - mergeMessages：去重、pending 被真实消息替换、乱序变升序；
  - validateBody：边界 0 / 1 / 1000 / 1001 / 纯空白；
  - dbReason：每个 code 都覆盖，另加一个未知 code；
  - strangerHint：四种情况；
  - formatChatTime：今天 / 昨天 / 今年 / 去年；
  - badgeText：0 / 5 / 100。
- [ ] **Step 2：**`deno test --sloppy-imports src/lib/community/messagesLogic_test.ts` → 失败。
- [ ] **Step 3：**实现 messagesLogic.ts、messages.ts，改 api.ts / failMessage。
- [ ] **Step 4：**`npm run -s test:unit` 全过。
- [ ] **Step 5：**集成测试新增两条：
  1. **主流程**：A、B 互关 → A openDirect(B) → A 发一条 → B listConversations 未读 1 → B markRead 后 0 → A 建群(B, C 先与 A 互关) → B 邀请 D（与 B 互关）→ D 能读群消息 → D 退群 → A 退群后 owner 为 B。另外 A 拉黑 B 后，B 给 A 发消息得 `unavailable`。
  2. **实时**：B 订阅 A–B 会话，A 发消息，5 秒内 B 收到同 id 的消息。
- [ ] **Step 6：**跑 `COMMUNITY_IT=1 … api_test.ts` 通过。再跑 tsc、lint，然后提交。

### Task 4: 未读红点、消息列表页与入口

**Files:**
- Create: `src/lib/community/useUnread.tsx`：`UnreadProvider`、`useUnread(): { total: number; refresh(): void }`。
  - 登录用户变化时、AppState 变为 active 时，拉一次 listConversations 求 totalUnread；
  - 游客为 0；
  - 状态按 userId 归属，做法同 useBlocks。
- Create: `src/app/messages/index.tsx`：消息列表。
  - 聚焦时 refresh 列表和红点。
  - 在本页时订阅 messages INSERT（不带过滤，RLS 只推我能看的），以及 conversation_members INSERT（`user_id=eq.me`，被拉进新群）；收到后 500ms 防抖重新拉列表。
  - 每行显示：头像（私信是对方头像；群聊用群名首字的 Avatar）、标题（私信是对方昵称，群是群名）、预览、formatChatTime、未读徽标。
  - 右上「发起群聊」→ `/messages/new-group`。
  - 空状态「还没有消息，去社区认识新朋友吧」。
  - 游客显示登录引导。
- Create: `src/components/Icons.tsx` 新增 `ChatIcon`（同现有图标风格）。
- Modify: `src/app/_layout.tsx`：
  - `UnreadProvider` 放在 `BlocksProvider` 里；
  - 注册 `messages/index`、`messages/[id]`、`messages/new-group`、`messages/group/[id]`。
- Modify: `src/app/(tabs)/index.tsx`：社区模式的 modeTabs 行右侧加消息图标按钮，有未读时显示红点；游客点了去登录。
- Modify: `src/components/community/MySocialRow.tsx`：在「我的主页」左边加「消息」按钮，带未读徽标。
- Modify: `src/app/user/[id].tsx`：看别人时，FollowButton 旁边加「私信」按钮。
  - 点按后调 `openDirect`，成功就进 `/messages/[id]`；
  - 失败用 failMessage 提示（unavailable →「对方暂时无法接收消息」）；
  - 我拉黑了对方时不显示这个按钮。

- [ ] **Step 1：**实现以上文件。纯逻辑已在 Task 3 测过。
- [ ] **Step 2：**tsc、lint、单测通过，提交。

### Task 5: 聊天页

**Files:**
- Create: `src/app/messages/[id].tsx`

**行为：**
- **加载**：
  - getConversation + listMembers + 第一页消息；
  - 成员资料用 getProfiles；
  - 私信还要拉 getSocialStats(peer)，得到 followsMe 给 strangerHint 用。
- **列表**：
  - inverted FlatList 显示气泡，自己的在右；
  - 群聊里别人的消息显示昵称和头像，点头像进主页；
  - 滚到顶加载更早一页；
  - 时间分隔：和上一条相隔 5 分钟以上时显示 formatChatTime。
- **群里被我拉黑的人**：消息用 `hideBlocked(rows, blocked, m => m.senderId)` 过滤。私信不过滤。
- **发送**：
  - validateBody；
  - 先乐观插入一条 pending 消息（临时 id），成功后用真实消息替换；
  - 失败时标为 failed，点按可重发，并按 reason 弹 toast；
  - 失败原因是 stranger_limit 时，常驻显示陌生人提示。
- **陌生人提示**：输入框上方显示「对方回复或关注你之前，只能发送 1 条消息」，条件是 strangerHint 为真（已加载全部历史时才按本地数据判断），或者上一次发送被 stranger_limit 拒绝。
- **实时**：
  - 进页时 subscribeMessages(conversationId)，收到后 mergeMessages；
  - 收到别人的消息时节流调用 markRead（最多每 2 秒 1 次）；
  - 进页和离开页时各 markRead 一次，并调用 useUnread().refresh；
  - AppState 回到 active 时重新拉第一页并合并。
- **长按别人的消息**：ActionSheet「举报」，打开 ReportSheet，调 `report({ messageId })`，toast「收到，我们会尽快处理」。
- **键盘**：照 Comments.tsx 的 KeyboardAvoidingView + keyboardUp 处理底部安全区。
- **顶栏**：返回；标题是对方昵称或群名；群聊右上角「···」进 `/messages/group/[id]`；私信点标题进对方主页。
- **sender_id 为 null**：显示「已注销用户」。

- [ ] **Step 1：**实现。
- [ ] **Step 2：**tsc、lint、单测通过，提交。

### Task 6: 发起群聊与群设置

**Files:**
- Create: `src/app/messages/new-group.tsx`
  - listMutuals → 用 getProfiles 补昵称头像 → 多选列表（去掉我拉黑的人）；
  - 群名输入框，默认用前 3 个昵称拼接，截到 30 字；
  - 选够 2 人后「创建」可点，成功后 replace 到 `/messages/[id]`；
  - 没有互关的人时显示「还没有互相关注的人，先去社区关注几位吧」。
- Create: `src/app/messages/group/[id].tsx`
  - 成员网格，群主带「群主」标记，点成员进主页；
  - 「邀请」打开同样的多选列表，只列不在群里的互关；
  - 群主可以改群名（复用 NicknameSheet 的输入样式，或新的简单输入 Sheet），也可以长按成员 →「移出群聊」并确认；
  - 「退出群聊」走 ConfirmDialog，确认后回到消息列表；
  - 显示人数「N/50」。

- [ ] **Step 1：**实现。
- [ ] **Step 2：**tsc、lint、单测、pgTAP、集成测试全过；`git checkout -- deno.lock`；提交。
- [ ] **Step 3：**交给用户：确认后执行生产迁移 010（另外确认生产库已开启 Realtime），然后按 Global Constraints 的 OTA 步骤发布。
