# 社区互动 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户可把自建菜发布到社区（快照），所有人可浏览、点赞、收藏、评论（一层回复）、举报，并可把别人的菜「存到我的菜谱」。

**Architecture:** 社区是独立于私有数据的一套表（`community_*`、`public_profiles`）和公开桶 `community-media`；发布 = 把私有菜复制成快照（图片用 Storage 跨桶 copy）。客户端新增 `src/lib/community/`：纯逻辑（Deno 单测）+ 接 Supabase 的 API（参数注入 client，便于对本地栈做集成测试）。私有表只加 `recipes.origin` 列和一个撤回触发器，RLS 与同步代码不动。

**Tech Stack:** Expo SDK 58 / RN 0.88 / expo-router / Reanimated 4；Supabase（Postgres + RLS + Storage）；测试：pgTAP（`supabase test db`）、Deno（`deno test`）、`tsc --noEmit`、`expo lint`、Expo Go 手测。

**Spec:** `docs/superpowers/specs/2026-11-19-community-design.md`（执行者必须同时读）

## Global Constraints

- 不改现有私有表（profiles、recipes、meal_plan_entries、shopping_items、recipe_prefs、cook_log、media_assets）的 RLS；不改私有桶 `recipe-media` 的策略；不改 `src/lib/sync/*` 的同步行为（只允许给 `recipes` 行加 `origin` 字段的读写）。
- 迁移文件：`supabase/migrations/007_community.sql`，幂等可重复执行（沿用 001–006 的 `if not exists` / `drop … if exists` 写法）。
- 永不向他人暴露邮箱或邮箱前缀；默认昵称 = `吃饭的人` + 4 位数字。
- 评论正文：trim 后 1–500 字（按 Unicode 码点计）。
- 举报原因枚举：`ad`（广告）/ `unfriendly`（不友善）/ `irrelevant`（不相关）/ `other`（其他）。
- 社区菜 `status`：`published` / `withdrawn` / `removed`；客户端只能在 published ↔ withdrawn 间切换。
- 收藏 id：别人的社区菜 = `community:<uuid>`；内置菜 = 内置 id；自己发布的菜 = 自己的私有菜 id。
- 内置菜作者显示「好好吃饭」。
- 公开桶 `community-media`：public，`file_size_limit = 5242880`，`allowed_mime_types = image/jpeg,image/png,image/webp`；路径 `{community_recipe_id}/{imageId}.jpg`，头像 `avatars/{userId}.jpg`。
- 新的底部弹层沿用 `plan.tsx` 里的 `backdropIn` / `sheetIn`（淡入 + SlideInDown ease-out），不要 `springify().damping(n)`。
- 所有提交在 `feat/community` 分支，不在 main 上提交。
- **生产库迁移（Task 12）必须先征得用户同意再执行。**

## 前置条件

- 本地 Supabase 栈需要 Docker（本机是 OrbStack，当前未运行）。执行 Task 1 前请用户启动 OrbStack，然后 `supabase start`。所有数据库测试只跑本地栈，绝不连生产库。
- Deno 已安装（`/opt/homebrew/bin/deno`）。

## Review Focus

1. **点赞 / 评论时断网或请求失败** → 乐观更新要回滚，并 toast「网络不太好，没发出去」；不能留下假的计数。测试放在 Task 4（`applyLikeToggle` 回滚）。
2. **发布时图片还没上传完**（刚选图、游客期的图、离线）→ 不能发布出缺图的快照，提示「图片还在上传，稍后再试」。测试放在 Task 3（`missingUploads`）。
3. **评论只有空格、换行，超过 500 字，或者带 emoji** → 空白拒绝，emoji 按 1 个字计，超长拒绝；服务端也要兜底。测试放在 Task 3（`validateCommentBody`）和 Task 2（pgTAP 的 check 约束）。
4. **连点点赞按钮** → 点赞要幂等，计数不会变成 2 或 -1。测试放在 Task 2（重复 insert/delete 后 `like_count` 正确）。
5. **打开详情页期间，作者撤回了这道菜** → 点赞、评论失败后，页面切到「已下架」状态，不崩溃也不卡转圈。测试放在 Task 4（API 把 RLS 拒绝映射为 `{ ok: false, reason: "unavailable" }`）。

---

### Task 1：迁移 —— 社区菜谱、公开资料、公开桶、私有表补丁

**Files:**
- Create: `supabase/migrations/007_community.sql`（本任务写前半：community_recipes、public_profiles、storage、recipes.origin、撤回触发器、内置菜 seed）
- Create: `supabase/tests/community_recipes_test.sql`（pgTAP）

**Interfaces:**
- Produces（表）：`public.community_recipes(id uuid pk default gen_random_uuid(), author_id uuid null references auth.users on delete cascade, source_recipe_id text not null, builtin boolean not null default false, name … cover jsonb（与 recipes 同名同类型的菜谱列）, status text not null default 'published' check in (published,withdrawn,removed), like_count int not null default 0, comment_count int not null default 0, published_at timestamptz, created_at, updated_at)`；唯一索引 `(coalesce(author_id,'00000000-0000-0000-0000-000000000000'), source_recipe_id)`。
- Produces：`public.public_profiles(user_id uuid pk references auth.users on delete cascade, nickname text not null check (char_length(btrim(nickname)) between 1 and 20), avatar_path text, updated_at)`。
- Produces：`public.recipes.origin jsonb null`。
- Produces：触发器 `recipes_withdraw_community`：`recipes.deleted` 从 false 变 true 时，`update community_recipes set status='withdrawn' where author_id = new.user_id and source_recipe_id = new.id and status='published'`（security definer）。
- Produces：5 道内置菜的 seed 行，`builtin = true`，`author_id = null`，`source_recipe_id` 为内置 id，uuid 固定为 `deterministic` 写死的常量（迁移里列出），内容从 `src/data/recipes.ts` 抄。
- Produces（RLS）：community_recipes：anon+authenticated 可 select `status='published'`；作者可 select 自己的全部行；作者可 insert/update 自己的行（`author_id = auth.uid()`）。列级保护用 before insert/update 触发器 `community_recipes_guard`：非 service_role 时强制保持 `like_count`、`comment_count` 为旧值（insert 时为 0），`builtin` 只能是 false，`status` 只能取 published/withdrawn，旧值是 removed 时不许改；status 变成 published 时刷新 `published_at = now()`。public_profiles：所有人可 select，本人可 insert/update。
- Produces（storage）：桶 `community-media`，值见 Global Constraints；策略：所有人可读；authenticated 可写/删 `{id}/…`（要求 `(storage.foldername(name))[1]` 是自己作为作者的 community_recipes.id），以及 `avatars/{auth.uid()}.jpg`。

- [ ] **Step 1：写失败的 pgTAP 测试** `supabase/tests/community_recipes_test.sql`，用 `tests.create_supabase_user` 风格的辅助 SQL（自己写 `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>"}'`）建用户 A、B。断言：
  - `has_table('public','community_recipes')`、`has_column('public','recipes','origin')`
  - A 插入一行 published → B 可见；A 改成 withdrawn → B 不可见、A 仍可见
  - anon 可见 published 的 5 道内置菜（`select count(*) where builtin` = 5）
  - A 插入时带 `like_count = 99` → 存下来的是 0；A 把 status 改成 `removed` → 报错
  - B 更新 A 的行 → 0 行受影响
  - A 的私有 recipes 行 `deleted` 改成 true → 对应社区行变为 `withdrawn`
  - `public_profiles`：B 能读 A 的昵称；B 改 A 的昵称 → 0 行；昵称为 `'   '` 时 insert 报错
- [ ] **Step 2：运行确认失败**：`supabase db reset && supabase test db` → 期望 FAIL（表不存在）
- [ ] **Step 3：按上面 Interfaces 写 `007_community.sql` 前半部分**
- [ ] **Step 4：运行确认通过**：`supabase db reset && supabase test db` → 期望全部 PASS；再执行一次 `supabase db reset` 确认迁移幂等不报错
- [ ] **Step 5：提交** `git add supabase/migrations/007_community.sql supabase/tests/community_recipes_test.sql && git commit -m "feat(db): 社区菜谱、公开资料、公开桶"`

### Task 2：迁移 —— 点赞、评论、举报

**Files:**
- Modify: `supabase/migrations/007_community.sql`（追加后半部分）
- Create: `supabase/tests/community_interactions_test.sql`

**Interfaces:**
- Consumes：Task 1 的 `community_recipes`
- Produces：`community_likes(user_id uuid references auth.users on delete cascade, community_recipe_id uuid references community_recipes on delete cascade, created_at, primary key(user_id, community_recipe_id))`
- Produces：`community_comments(id uuid pk, community_recipe_id uuid references community_recipes on delete cascade, user_id uuid references auth.users on delete cascade, parent_id uuid null references community_comments, body text not null, deleted boolean default false, hidden boolean default false, created_at)`；check：`deleted or char_length(btrim(body)) between 1 and 500`
- Produces：`community_reports(id uuid pk, reporter_id uuid references auth.users on delete cascade, community_recipe_id uuid null, comment_id uuid null, reason text check in (ad,unfriendly,irrelevant,other), created_at, resolved boolean default false)`；check 两个目标列恰好一个非空；唯一 `(reporter_id, coalesce(community_recipe_id, comment_id))`
- Produces（触发器）：
  - `community_likes` insert/delete 维护 `like_count`（security definer，+1/-1，不低于 0）
  - `community_comments` insert 维护 `comment_count`；`deleted` 从 false 变 true 时 -1，同时把 `body` 置为空串
  - insert 时校验：`parent_id` 指向的评论自身 `parent_id is null`，并且属于同一道菜，否则报错
- Produces（RLS）：
  - likes：所有人可 select；本人可 insert/delete，且目标菜必须是 published
  - comments：所有人可 select `hidden = false`，并且所属菜是 published 且父评论（如有）`hidden = false`；本人可 insert（菜必须 published）；本人或该菜作者可 update，只能把 `deleted` 改成 true（用 before update 触发器保证其余列不变）
  - reports：本人可 insert，不开放 select

- [ ] **Step 1：写失败的 pgTAP 测试**，断言：
  - B 给 A 的菜点赞两次，第二次因主键冲突报错，`like_count = 1`；取消两次，`like_count = 0`，不会是 -1
  - 给 withdrawn 的菜点赞或评论 → 被 RLS 拒绝
  - 评论正文 `'  '` 和 501 个字符 → 报错；500 个 emoji（`repeat('🍜',500)`）→ 成功
  - 回复的回复（parent 本身有 parent）→ 报错；parent 属于另一道菜 → 报错
  - B 删除自己的评论 → `body = ''`、`comment_count` 减 1；A（菜的作者）能删 B 的评论；C 不能删
  - 用 service_role 把评论 `hidden` 设为 true → anon 看不到它和它的回复
  - B 重复举报同一目标 → 报错；B 去 select 举报表 → 0 行
- [ ] **Step 2：运行确认失败**：`supabase db reset && supabase test db`
- [ ] **Step 3：实现迁移后半部分**
- [ ] **Step 4：运行确认通过**（两个测试文件全部 PASS，重复 reset 不报错）
- [ ] **Step 5：提交** `feat(db): 社区点赞、评论、举报`

### Task 3：纯逻辑模块 + Deno 测试脚手架

**Files:**
- Create: `src/lib/community/logic.ts`（不得 import 任何 react-native / expo / supabase 模块）
- Create: `src/lib/community/logic_test.ts`
- Modify: `tsconfig.json`：exclude 里加 `"**/*_test.ts"`
- Modify: `package.json`：加脚本 `"test:unit": "deno test --sloppy-imports src/lib/community"`

**Interfaces（Produces，全部从 `logic.ts` 导出）：**
- `type CommunityRecipe = { id: string; authorId: string | null; sourceRecipeId: string; builtin: boolean; status: "published" | "withdrawn" | "removed"; likeCount: number; commentCount: number; publishedAt: string | null; recipe: Omit<Recipe, "id" | "custom" | "updatedAt"> }`
- `const COMMUNITY_PREFIX = "community:"`；`communityFavoriteId(id: string): string`；`parseCommunityFavoriteId(fav: string): string | null`
- `favoriteIdFor(cr: Pick<CommunityRecipe,"id"|"authorId"|"sourceRecipeId"|"builtin">, currentUserId: string | null): string`：内置菜或自己的菜 → `sourceRecipeId`，否则 → `community:<id>`
- `planPool(favorites: string[], allRecipeIds: string[]): string[]`：去掉 `community:` 开头的 id，去掉后为空就返回 allRecipeIds
- `defaultNickname(rand: () => number): string`：返回 `吃饭的人` + 4 位数字（rand 注入，便于测试）
- `validateNickname(s: string): { ok: true; value: string } | { ok: false; error: string }`：trim 后 1–20 个码点；不能包含 `@`，防止把邮箱当昵称
- `validateCommentBody(s: string): { ok: true; value: string } | { ok: false; error: "empty" | "too_long" }`：按码点计数
- `missingUploads(recipe: Pick<Recipe,"cover"|"steps">): number`：封面和步骤图里缺 `path` 的张数
- `toSnapshot(recipe: Recipe, communityId: string): { row: Record<string, unknown>; copies: { from: string; to: string }[] }`：把每张图的 path 改写成 `{communityId}/{image.id}.jpg`，同时列出私有桶→公开桶的复制清单；row 的列名与 `community_recipes` 一致（snake_case），去掉 `localUri`
- `fromSnapshot(cr: CommunityRecipe, userId: string, newRecipeId: string, authorNickname: string): { input: CustomRecipeInput; origin: { communityId: string; authorNickname: string }; copies: { from: string; to: string }[] }`：图片路径改写成 `{userId}/{newRecipeId}/{image.id}.jpg`
- `type CommentRow = { id: string; parentId: string | null; userId: string; body: string; deleted: boolean; createdAt: string }`；`threadComments(rows: CommentRow[]): { comment: CommentRow; replies: CommentRow[] }[]`：顶层评论按时间倒序，回复按时间正序；已删除且没有回复的顶层评论丢弃，有回复的保留（UI 显示「该评论已删除」）；已删除的回复丢弃

- [ ] **Step 1：写失败的测试** `logic_test.ts`（`jsr:@std/assert`），每个函数至少覆盖：
  - `favoriteIdFor`：内置菜 → `"tomato-pasta"`；自己的菜 → 私有 id；别人的菜 → `"community:<uuid>"`；未登录看别人的菜 → `"community:<uuid>"`
  - `planPool(["a","community:x"], ["a","b"])` → `["a"]`；`planPool(["community:x"], ["a","b"])` → `["a","b"]`
  - `defaultNickname(() => 0.0421)` 符合 `/^吃饭的人\d{4}$/`
  - `validateNickname("me@qq.com")` → 不通过；`"  小王  "` → `value = "小王"`
  - `validateCommentBody(" \n ")` → `empty`；`"🍜".repeat(500)` → 通过；`"a".repeat(501)` → `too_long`
  - `missingUploads`：封面有 path、某一步有 1 张没 path → 1
  - `toSnapshot`：结果里没有 `localUri`；`copies` 的数量等于图片张数；路径符合约定格式
  - `threadComments`：已删除、无回复的顶层评论被丢弃；已删除、有回复的被保留
- [ ] **Step 2：运行确认失败**：`npm run test:unit` → FAIL（模块不存在）
- [ ] **Step 3：实现 `logic.ts`**
- [ ] **Step 4：运行确认通过**：`npm run test:unit` PASS；`npx tsc --noEmit` 退出码 0
- [ ] **Step 5：提交** `feat(community): 纯逻辑与单测`

### Task 4：社区 API 层（含 Storage 复制）

**Files:**
- Create: `src/lib/community/api.ts`（所有函数的第一个参数是 `client: SupabaseClient`；不 import `../supabase`）
- Create: `src/lib/community/api_test.ts`（集成测试，只在设置了 `COMMUNITY_IT=1` 时运行，连本地栈 `http://127.0.0.1:54321`）

**Interfaces（Produces）：**
- `type Result<T> = { ok: true; value: T } | { ok: false; reason: "unavailable" | "network" | "auth" | "invalid" }`。RLS 拒绝或 0 行受影响 → `unavailable`；fetch 失败 → `network`
- `listCommunity(client, opts: { sort: "latest" | "hot"; offset: number; limit: number }): Promise<Result<CommunityRecipe[]>>`：hot 按 `like_count desc, published_at desc` 排序
- `getCommunityRecipe(client, id): Promise<Result<CommunityRecipe>>`
- `getCommunityRecipes(client, ids: string[]): Promise<Result<CommunityRecipe[]>>`（收藏页用；不可见的 id 不返回）
- `findMyPublication(client, userId, sourceRecipeId): Promise<Result<CommunityRecipe | null>>`
- `publishRecipe(client, userId, recipe: Recipe): Promise<Result<CommunityRecipe>>`：`missingUploads > 0` 时返回 `invalid`；已有行就复用其 id，没有就新建 uuid；用 `toSnapshot` 得到行和复制清单；先删公开桶 `{id}/` 下的旧文件，再逐张 `storage.from("recipe-media").copy(from, to, { destinationBucket: "community-media" })`（并发 3），然后 upsert 行，`status = 'published'`
- `withdrawRecipe(client, communityId): Promise<Result<void>>`：status 改为 withdrawn，并删除公开桶目录
- `cleanupWithdrawnMedia(client, userId): Promise<void>`：作者自己 withdrawn 状态的行，若公开桶目录下还有文件就删掉（启动时调用，处理触发器撤回的情况）
- `setLike(client, userId, communityId, liked: boolean): Promise<Result<void>>`：重复点赞的主键冲突、取消不存在的赞都按成功处理
- `myLikes(client, userId, ids: string[]): Promise<Result<Set<string>>>`
- `listComments(client, communityId): Promise<Result<CommentRow[]>>`；`addComment(client, userId, communityId, body, parentId?: string)`；`deleteComment(client, commentId)`
- `report(client, userId, target: { recipeId: string } | { commentId: string }, reason)`：重复举报按成功处理
- `getProfiles(client, userIds: string[]): Promise<Result<Map<string, { nickname: string; avatarUrl: string | null }>>>`（avatarUrl 用 `getPublicUrl` 生成）
- `ensurePublicProfile(client, userId, nickname: string): Promise<Result<void>>`；`syncPublicAvatar(client, userId, privateAvatarPath: string | null): Promise<Result<void>>`：私有桶 → `community-media/avatars/{userId}.jpg`（用 upsert 覆盖）；为 null 时删除公开头像并清空 `avatar_path`
- `applyLikeToggle(state: { liked: boolean; count: number }): { next: { liked: boolean; count: number }; rollback: { liked: boolean; count: number } }`：纯函数，同样放在 `logic.ts` 并在 `logic_test.ts` 里测

- [ ] **Step 1：写失败的测试**
  - `logic_test.ts` 追加 `applyLikeToggle`：`{false,3}` → next `{true,4}`、rollback `{false,3}`；`{true,0}` → next `{false,0}`（不会变成负数）
  - `api_test.ts`（用本地 service key 建用户 A、B，用 anon key + 登录拿到各自的 client）：A 上传私有图 → `publishRecipe` → B 用 `getPublicUrl` 能 fetch 到 200；A `withdrawRecipe` 后同一 URL 返回 400 或 404，B `getCommunityRecipe` 得到 `unavailable`；B `setLike` 连续两次 true → ok，计数为 1；B 在撤回后的菜上 `addComment` → `unavailable`；B 重复 `report` → 两次都 ok
- [ ] **Step 2：运行确认失败**：`npm run test:unit`、`COMMUNITY_IT=1 deno test --sloppy-imports --allow-net --allow-env src/lib/community/api_test.ts`
- [ ] **Step 3：实现 `api.ts`**（本地 URL 和 key 从 `supabase status -o env` 读，测试通过环境变量传入）
- [ ] **Step 4：运行确认通过**；`npx tsc --noEmit` 退出码 0
- [ ] **Step 5：提交** `feat(community): API 层与集成测试`

### Task 5：store 接入（origin、收藏池、存到我的菜谱）

**Files:**
- Modify: `src/data/recipes.ts`：`Recipe` 加 `origin?: { communityId: string; authorNickname: string }`
- Modify: `src/lib/sync/mutations.ts`：`buildRecipeRow` 参数和返回值加 `origin`（默认 null）
- Modify: `src/lib/sync/pull.ts:155`：select 加上 `origin`；映射处把 `origin` 写回 Recipe
- Modify: `src/state/store.tsx`：`CustomRecipeInput` 加 `origin?`；`createRecipe` 透传；`pushRecipe` 带上 origin；`planThreeDays` 用 `planPool(favorites, allRecipes.map(r => r.id))`
- Create: `src/lib/community/useSaveToMine.ts`：`useSaveToMine(): (cr: CommunityRecipe, authorNickname: string) => Promise<{ ok: true; recipeId: string; existed: boolean } | { ok: false; reason: Result<never>["reason"] }>`：先在 `customRecipes` 里按 `origin.communityId` 查找，找到就返回 `existed: true`；否则调用 `fromSnapshot` → 从公开桶 copy 到私有桶（`destinationBucket: "recipe-media"`）→ `createRecipe({ ...input, origin })`

- [ ] **Step 1：写失败的测试**：`logic_test.ts` 追加 `fromSnapshot` 的用例（图片路径改写到 `{userId}/{newRecipeId}/`，origin 字段正确）；`api_test.ts` 追加：B 把 A 的菜从公开桶 copy 到 B 的私有桶，B 能用签名 URL 读到
- [ ] **Step 2：运行确认失败**
- [ ] **Step 3：实现**；`planThreeDays` 只把取池子那一行换成 `planPool`，其余不动
- [ ] **Step 4：验证**：单测和集成测试通过；`npx tsc --noEmit` 退出码 0；`git diff src/lib/sync` 只涉及 origin 相关的行
- [ ] **Step 5：提交** `feat(community): 存到我的菜谱、收藏池跳过社区菜`

### Task 6：公开资料与昵称

**Files:**
- Create: `src/lib/community/useCommunityProfile.ts`：`useCommunityProfile(): { profile: { nickname: string } | null; ensure: () => Promise<boolean>; rename: (s: string) => Promise<Result<void>> }`；`ensure()` 在没有资料时弹出 `NicknameSheet`，用户确认后返回 true，取消返回 false
- Create: `src/components/community/NicknameSheet.tsx`：底部弹层，输入框默认值为 `defaultNickname(Math.random)`，用 `validateNickname` 校验，按钮文案「就叫这个」，说明文字「其他人会在你的评论和菜谱上看到这个名字」
- Modify: `src/app/account.tsx`：加一行「社区昵称」，点击打开 `NicknameSheet` 改名
- Modify: `src/lib/account.ts` 的 `replaceAvatar`：成功后若已有 public_profile，调用 `syncPublicAvatar`；`ensurePublicProfile` 首次创建时也同步一次头像

- [ ] **Step 1**：`npx tsc --noEmit`、`npx expo lint` 通过
- [ ] **Step 2：Expo Go 手测**：新账号第一次评论时弹出昵称，默认值形如「吃饭的人1234」；输入 `a@b.com` 时被拒绝；在账号页改名后，评论区立即显示新名字；换头像后，另一台设备或账号刷新能看到新头像
- [ ] **Step 3：提交** `feat(community): 社区昵称与公开头像`

### Task 7：发现页「菜谱 / 社区」切换与社区列表

**Files:**
- Create: `src/components/community/CommunityFeed.tsx`：双列瀑布流，复用 `RecipeTile` / `splitColumns` / `coverHeightFor`；顶部用小分段切换「最新 / 最热」；每页 20 条，滚动到底加载下一页；支持下拉刷新；卡片角标显示 ♥ 点赞数和 💬 评论数；封面用 `getPublicUrl`，内置菜没有封面时用 `FoodArt`
- Modify: `src/app/(tabs)/index.tsx`：在顶部问候语下面加分段控件「菜谱 / 社区」（样式沿用该页已有的 `tablist` 筛选条）；选「社区」时整页内容换成 `<CommunityFeed />`，选「菜谱」时保持现状
- Modify: `src/components/RecipeTile.tsx`：加可选 prop `stats?: { likes: number; comments: number }`

- [ ] **Step 1**：`tsc`、`lint` 通过
- [ ] **Step 2：Expo Go 手测**：切到社区能看到 5 道内置菜；断网时显示「网络不太好」和重试按钮，不白屏；最热排序生效；切回「菜谱」后原来的滚动位置和筛选都还在
- [ ] **Step 3：提交** `feat(community): 发现页社区列表`

### Task 8：社区菜详情页

**Files:**
- Create: `src/components/recipe/RecipeBody.tsx`：从 `src/app/recipe/[id].tsx` 抽出「食材 / 步骤 / 小贴士」三段的展示部分，入参为 `recipe: Recipe` 和 `imageUri: (image: StepImage) => string | null`；`recipe/[id].tsx` 改用它，渲染结果不变
- Create: `src/app/community/[id].tsx`：头图加标题；作者行（头像、昵称，内置菜显示「好好吃饭」）；`<RecipeBody>`（图片地址用公开 URL）；底部操作栏：赞（数字）、收藏（用 `favoriteIdFor` 算出 id 后调用 `toggleFavorite`，未登录时跳登录页）、「存到我的菜谱」（内置菜和自己的菜不显示；`existed` 时提示「已存到我的菜谱」并跳转过去）、评论数（点击滚动到评论区）；右上角「…」菜单里有「举报这道菜」
- 点赞走 `applyLikeToggle` 做乐观更新，失败时回滚并 toast；任一 API 返回 `unavailable` 时整页切换为「这道菜已下架」空状态，提供返回按钮

- [ ] **Step 1**：`tsc`、`lint` 通过；改完后打开 `recipe/[id]` 页面，确认渲染与改之前完全一致
- [ ] **Step 2：Expo Go 手测**：账号 A 发布 → 账号 B 打开详情 → 点赞后计数 +1，连点不会出现异常数字；断网点赞会回滚并 toast；A 撤回后 B 再点赞，页面变成「已下架」；B 存到我的菜谱后，能把这道菜排进计划、进入烹饪模式，离线也能打开
- [ ] **Step 3：提交** `feat(community): 社区菜详情`

### Task 9：评论区

**Files:**
- Create: `src/components/community/Comments.tsx`：用 `threadComments` 渲染；已删除的顶层评论显示「该评论已删除」；回复缩进一层；底部固定输入框（随键盘上移，按 `validateCommentBody` 校验，超长时显示 `500/500` 计数并禁用发送）；点「回复」时输入框显示「回复 @昵称」；长按评论弹出操作弹层：自己的评论或菜的作者可「删除」（需二次确认，用 `ConfirmDialog`），所有人可「举报」（4 个原因）
- 发评论、回复、举报前先调 `useCommunityProfile().ensure()`；未登录时跳登录页

- [ ] **Step 1**：`tsc`、`lint` 通过
- [ ] **Step 2：Expo Go 手测**：发评论、回复、删除（有回复时显示「该评论已删除」）；作者能删别人的评论；其他人看不到「删除」；纯空格不能发送；举报后 toast「收到，我们会尽快处理」，同一条再举报也不报错；在 Dashboard 把某条评论设为 `hidden`，刷新后它和回复一起消失
- [ ] **Step 3：提交** `feat(community): 评论、回复、举报`

### Task 10：在自己的菜谱上发布、更新、撤回

**Files:**
- Modify: `src/app/recipe/[id].tsx`：自建菜右上角在「编辑」旁边加「…」按钮，打开底部弹层。未发布时显示「发布到社区」；已发布时显示「更新到社区」「撤回」，标题旁加「已发布」小标记。发布前调用 `ensure()`；`publishRecipe` 返回 `invalid` 时 toast「图片还在上传，稍后再试」，并触发一次媒体 flush。撤回前用 `ConfirmDialog` 确认（「撤回后其他人看不到这道菜，点赞和评论会保留，重新发布即可恢复」）
- Modify: `src/app/_layout.tsx` 或现有的启动同步入口：登录后调用一次 `cleanupWithdrawnMedia`
- 详情页显示「来自 @昵称」：`recipe.origin` 存在时，显示在副标题下方

- [ ] **Step 1**：`tsc`、`lint` 通过
- [ ] **Step 2：Expo Go 手测**：刚选完图立刻发布 → 提示稍后再试，几秒后再发布成功；修改菜谱后点「更新到社区」，B 刷新能看到新内容；撤回后 B 看不到，公开图片链接失效；在另一台设备删除这道私有菜后，社区版本变为撤回，作者下次启动 App 时公开图片被清掉
- [ ] **Step 3：提交** `feat(community): 发布、更新、撤回`

### Task 11：收藏页显示社区菜

**Files:**
- Modify: `src/app/(tabs)/favorites.tsx`：把 `favorites` 里的 `community:` id 用 `parseCommunityFavoriteId` 解析出来，通过 `getCommunityRecipes` 拉取后和本地收藏合并显示；拉取失败或没返回的 id 显示「已下架」卡片（灰色，按钮为「取消收藏」）；点击社区菜进入 `/community/[id]`
- 离线时社区收藏显示占位卡片「联网后显示」，不算作已下架

- [ ] **Step 1**：`tsc`、`lint` 通过
- [ ] **Step 2：Expo Go 手测**：收藏别人的菜后，收藏页能看到；作者撤回后变成「已下架」；断网时显示「联网后显示」；「一键排三天」不会排进社区菜
- [ ] **Step 3：提交** `feat(community): 收藏页支持社区菜`

### Task 12：管理 SQL、上线

**Files:**
- Create: `docs/community-admin.md`：常用 SQL —— 查看未处理举报（关联出被举报的菜名或评论内容、举报人昵称）、下架菜谱（`update community_recipes set status='removed'`）、隐藏评论（`update community_comments set hidden=true`）、把举报标记为已处理

- [ ] **Step 1**：在本地栈上把文档里的每条 SQL 执行一遍，确认都能跑通
- [ ] **Step 2：完整回归**：`supabase db reset && supabase test db`、`npm run test:unit`、集成测试、`tsc`、`lint` 全部通过
- [ ] **Step 3：先停下来请用户确认**，然后在生产库执行迁移：`supabase db push`（目标项目 `ycjqegldhutefwhzvplc`）；执行后用只读查询确认 5 道内置菜已经 seed、桶 `community-media` 存在
- [ ] **Step 4：提交** `docs(community): 管理 SQL`
