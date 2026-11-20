# 第一期：关注、用户主页、拉黑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 社区里点头像/昵称进入用户主页，可关注、看关注/粉丝列表、拉黑和举报用户。

**Architecture:** 新迁移 009 加 follows / blocks 两张表、举报用户的列和一个统计 RPC；规则全部在 RLS + 触发器里，用 pgTAP 测。客户端新增 `src/lib/community/social.ts`（注入 SupabaseClient，Result 风格，同 api.ts）和纯逻辑 `socialLogic.ts`；界面新增 `/user/[id]`、`/user/follows`、`/blocked` 三个页面和一个黑名单 Context。

**Tech Stack:** Expo SDK 58 / expo-router / Reanimated 4 / TypeScript strict / Supabase (Postgres, RLS, pgTAP) / Deno 单测

**Spec:** `docs/superpowers/specs/2026-11-20-social-follow-messages-design.md`（第一期部分）

## Global Constraints

- 只走 OTA：不加依赖、不改 package.json（scripts 也不改，会改 OTA 指纹）。
- 所有社交操作需要登录；游客走现有 `requireLogin` / `/sign-in`。
- 规则在数据库强制，不能只靠客户端。
- 被拉黑方关注拉黑者 → 提示「暂时无法关注」，不说原因。
- 拉黑时删除双方之间已有的关注。拉黑关系只有拉黑者能读。
- 关注 / 粉丝列表对登录用户可见；anon 不可见。
- 举报沿用 community_reports：每人对同一目标一次，重复举报算成功。
- 生产库迁移先问用户。测试跑完 `git checkout -- deno.lock`。
- 面向用户的文案用简体中文。

## Review Focus

1. 连点「关注」：第二次插入主键冲突 → 当作成功，按钮不闪错。（Task 2 测）
2. 看自己的主页：没有关注/拉黑按钮，改为「编辑昵称」。（Task 4）
3. 对方没有 public_profiles 行（从未发过菜）：主页显示默认昵称，不报错。（Task 4）
4. 拉黑后对方的社区菜谱、评论在我这边消失；解除后恢复。（Task 3 单测过滤函数）
5. 已撤回（withdrawn）的菜不出现在主页。（Task 1 已有 RLS 保证；Task 2 查询加 status 条件）

---

### Task 1: 迁移 009 + pgTAP

**Files:**
- Create: `supabase/migrations/009_social_follow.sql`
- Create: `supabase/tests/social_follow_test.sql`

**Interfaces — Produces:**
- `public.follows(follower_id uuid, followee_id uuid, created_at timestamptz)` PK(follower_id, followee_id)，check follower ≠ followee，两列都 references auth.users on delete cascade；索引 (followee_id, created_at desc)。
- `public.blocks(blocker_id uuid, blocked_id uuid, created_at)` PK 两列，check 不等，cascade。
- `community_reports.reported_user_id uuid references auth.users on delete cascade`；one_target 约束改为三选一恰好一个非空；唯一索引改为 `(reporter_id, coalesce(community_recipe_id, comment_id, reported_user_id))`。
- RPC `public.social_stats(target uuid) returns table(following_count int, follower_count int, i_follow boolean, follows_me boolean)`，stable，可由 authenticated 调用；anon 调用报错或返回 0（选报错）。
- 拉黑相关错误：关注被拦时 `raise exception 'follow_blocked' using errcode = 'P0001'`。

**规则：**
- follows：select 给 authenticated（全部可读）；insert with check follower_id = auth.uid()；delete using follower_id = auth.uid()；无 update。insert 前触发器（security definer）查 blocks 任一方向存在 → follow_blocked。
- blocks：select/insert/delete 只限 blocker_id = auth.uid()；无 update。insert 后触发器（security definer）删除双方之间的 follows。

- [ ] Step 1: 写 pgTAP（A/B/C 三个用户），至少覆盖：表存在；B 关注 A 成功；重复关注 23505；不能替别人关注 42501；不能关注自己 23514；C 能读到 B→A；anon 读 follows 为 0；B 取关成功、C 不能删 B 的关注；social_stats 计数和 i_follow/follows_me 正确；A 拉黑 B 后 B→A 与 A→B 关注都被删；B 再关注 A 抛 P0001；A 关注 B 也抛 P0001；B 读不到 A 的拉黑记录；A 解除拉黑后 B 可再关注；举报用户成功、重复举报 23505、三目标全空被拒。
- [ ] Step 2: `supabase db reset && supabase test db` → 新测试失败（表不存在）。
- [ ] Step 3: 写迁移（风格照 007：`if not exists`、`drop policy if exists`、函数 `set search_path = public, pg_temp`、revoke 触发器函数）。
- [ ] Step 4: `supabase db reset && supabase test db` → 全部通过（含原有 99 个）。
- [ ] Step 5: 提交。

### Task 2: 数据访问层与纯逻辑

**Files:**
- Create: `src/lib/community/social.ts`、`src/lib/community/socialLogic.ts`、`src/lib/community/socialLogic_test.ts`
- Modify: `src/lib/community/api.ts`（`report` 的 target 增加 `{ userId: string }`；导出 `reasonOf`/`ok`/`fail` 供 social.ts 复用，或 social.ts 内部从 api.ts 引入）
- Modify: `src/lib/community/api_test.ts`（集成流程）

**Interfaces — Produces:**
- `socialLogic.ts`：
  - `type FollowState = "none" | "following" | "mutual" | "followed_by"`
  - `followState(iFollow: boolean, followsMe: boolean): FollowState`
  - `followButtonLabel(s: FollowState): string` → none「关注」、followed_by「回关」、following「已关注」、mutual「互相关注」
  - `hideBlocked<T>(rows: T[], blocked: ReadonlySet<string>, authorOf: (r: T) => string | null): T[]`
- `social.ts`（第一个参数都是 SupabaseClient，返回 `Result<…>`）：
  - `follow(client, me, target)`：23505 视为成功；P0001 → `fail("unavailable")`
  - `unfollow(client, me, target)`：0 行也算成功
  - `getSocialStats(client, target): Result<{ following: number; followers: number; iFollow: boolean; followsMe: boolean }>`
  - `listFollows(client, userId, kind: "following" | "followers", before?: string): Result<{ userId: string; createdAt: string }[]>`，每页 30，按 created_at desc
  - `block(client, me, target)`（23505 成功）、`unblock(client, me, target)`、`myBlocks(client, me): Result<string[]>`
  - `listUserRecipes(client, userId): Result<CommunityRecipe[]>`：author_id = userId 且 status = 'published'，按 published 时间倒序（用 api.ts 现有的列和 rowToCommunityRecipe）

- [ ] Step 1: Deno 单测：followState 四种组合；按钮文案；hideBlocked 过滤掉被拉黑作者、保留 authorOf 为 null 的行。
- [ ] Step 2: `deno test --sloppy-imports src/lib/community/socialLogic_test.ts` → 失败。
- [ ] Step 3: 实现两个文件。
- [ ] Step 4: 单测通过；`npm run test:unit` 全过。
- [ ] Step 5: 集成测试新增流程：B 关注 A（两次都 ok）→ stats 正确 → A 拉黑 B → B follow A 得 unavailable、A 的 stats 粉丝 0 → myBlocks 含 B → unblock → B 再关注 ok → reportUser 两次都 ok。`COMMUNITY_IT=1 deno test --sloppy-imports --allow-net --allow-env src/lib/community/api_test.ts` 通过。
- [ ] Step 6: `npx tsc --noEmit`，提交。

### Task 3: 黑名单 Context 与内容过滤

**Files:**
- Create: `src/lib/community/useBlocks.tsx`
- Modify: `src/app/_layout.tsx`（包在 CommunityProfileProvider 内）
- Modify: `src/components/community/CommunityFeed.tsx`、`src/components/community/Comments.tsx`

**Interfaces — Produces:**
- `BlocksProvider`；`useBlocks(): { blocked: ReadonlySet<string>; block(id): Promise<Result<void>>; unblock(id): Promise<Result<void>>; refresh(): Promise<void> }`。登录用户变化时重新拉 myBlocks；游客为空集合。
- Feed 用 `hideBlocked(rows, blocked, r => r.authorId)`；评论同理按 userId 过滤（被拉黑者的顶层评论连同其回复一起隐藏；别人回复里的被拉黑者回复单独隐藏）。

- [ ] Step 1: 实现 Provider 和两个过滤点（纯过滤逻辑已在 Task 2 测过）。
- [ ] Step 2: tsc、lint 通过，提交。

### Task 4: 用户主页与关注列表

**Files:**
- Create: `src/app/user/[id].tsx`、`src/app/user/follows.tsx`（参数 `id`、`tab=following|followers`）
- Create: `src/components/community/FollowButton.tsx`
- Create: `src/components/community/Avatar.tsx`（把 Comments.tsx 里的 Avatar 搬出来共用）
- Modify: `src/app/_layout.tsx` 注册 `user/[id]`、`user/follows`

**界面：**
- 顶栏照 account.tsx（返回键、标题为昵称），右上「···」（看别人时）：拉黑 / 解除拉黑、举报用户（ReportSheet）。拉黑前用 ActionSheet 确认，文案「拉黑后，你们将无法互相关注和私信，你也不会再看到 Ta 的内容」。
- 头部：大头像、昵称、「关注 N · 粉丝 N」两个可点数字（进 follows 页）、FollowButton。自己：按钮换成「编辑昵称」（打开现有 NicknameSheet）。
- 菜谱区：listUserRecipes 结果的两列网格（复用 RecipeTile 风格），点进 `/community/[id]`；空状态「还没有发布菜谱」。
- FollowButton：props `{ targetId, state, onChange }`；乐观更新，失败回滚；unavailable 提示「暂时无法关注」；游客点按跳 `/sign-in`。
- follows 页：两个分段「关注 / 粉丝」，行 = 头像 + 昵称 + FollowButton（自己那行不显示按钮），滚到底加载下一页，点行进主页。行的关注状态：对列表里的 id 批量查我是否关注（follows where follower_id = me and followee_id in …）与是否关注我，放进 social.ts 的 `relationsTo(client, me, ids): Result<Map<string, FollowState>>`。

- [ ] Step 1: 实现 relationsTo，并在 socialLogic_test 不需新增（它只是查询 + followState）。集成测试补一条 relationsTo 结果断言。
- [ ] Step 2: 实现页面和组件。
- [ ] Step 3: tsc、lint、单测通过，提交。

### Task 5: 入口与黑名单页

**Files:**
- Modify: `src/app/community/[id].tsx`（作者行可点 → `/user/[authorId]`；内置菜不可点）
- Modify: `src/components/community/Comments.tsx`（头像、昵称可点 → 主页；不影响点按评论回复：头像昵称单独 Pressable）
- Modify: `src/app/(tabs)/profile.tsx`（已登录时显示「关注 N / 粉丝 N」，点进 follows 页；「我的主页」入口）
- Modify: `src/app/account.tsx`（「黑名单」一行 → `/blocked`）
- Create: `src/app/blocked.tsx`（列出被拉黑的人，每行「解除」）

- [ ] Step 1: 实现。
- [ ] Step 2: tsc、lint、单测、pgTAP 全过；`git checkout -- deno.lock`；提交。
- [ ] Step 3: 交给用户：确认后执行生产迁移 009，fingerprint:compare 一致后推 OTA。
