-- 社区互动 · 007（幂等，可重复执行）
-- 方案：发布 = 把私有菜复制一份快照到 community_recipes，图片复制到公开桶 community-media。
-- 私有表（recipes 等）的 RLS 和私有桶 recipe-media 的策略一律不动；
-- recipes 只加一个可空列 origin 和一个「删菜 → 撤回社区菜」的触发器。

-- ------------------------------------------------------- community_recipes
-- 菜谱列（name … cover）与 public.recipes 同名同类型，客户端一套映射两边用。
create table if not exists public.community_recipes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users (id) on delete cascade,   -- 内置菜为 null
  source_recipe_id text not null,                                 -- 作者私有菜 id / 内置 id
  builtin boolean not null default false,
  name text not null,
  subtitle text,
  description text,
  minutes int,
  difficulty text,
  calories int,
  tags jsonb not null default '[]'::jsonb,
  art text,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  heat text,
  tips jsonb not null default '[]'::jsonb,
  step_minutes jsonb not null default '[]'::jsonb,
  cover jsonb,
  status text not null default 'published'
    check (status in ('published', 'withdrawn', 'removed')),
  like_count int not null default 0,
  comment_count int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同一道私有菜只对应一条社区菜（重复发布 = 更新）。author_id 可为 null（内置菜），
-- 普通唯一约束里 null 互不相等，所以用 coalesce 表达式索引。
create unique index if not exists community_recipes_author_source_uidx
  on public.community_recipes (
    (coalesce(author_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    source_recipe_id
  );
create index if not exists community_recipes_published_idx
  on public.community_recipes (published_at desc) where status = 'published';

alter table public.community_recipes enable row level security;

drop policy if exists community_recipes_read_published on public.community_recipes;
drop policy if exists community_recipes_author_select on public.community_recipes;
drop policy if exists community_recipes_author_insert on public.community_recipes;
drop policy if exists community_recipes_author_update on public.community_recipes;

create policy community_recipes_read_published on public.community_recipes
  for select to anon, authenticated using (status = 'published');
create policy community_recipes_author_select on public.community_recipes
  for select to authenticated using (author_id = auth.uid());
create policy community_recipes_author_insert on public.community_recipes
  for insert to authenticated with check (author_id = auth.uid());
create policy community_recipes_author_update on public.community_recipes
  for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
-- 不给 delete：不做硬删除，只有账号注销时级联。

-- 列级保护：RLS 管不到「哪些列能改」，用触发器兜。
-- 只约束客户端角色（anon / authenticated）；service_role、Dashboard 里的 postgres、
-- 以及 security definer 函数（计数触发器、删菜撤回触发器）都放行。
create or replace function public.community_recipes_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client boolean := current_user in ('anon', 'authenticated');
begin
  if v_client then
    if tg_op = 'INSERT' then
      new.like_count := 0;
      new.comment_count := 0;
    else
      if old.status = 'removed' then
        raise exception 'community recipe % has been removed', old.id using errcode = 'check_violation';
      end if;
      new.like_count := old.like_count;
      new.comment_count := old.comment_count;
    end if;
    if new.builtin then
      raise exception 'builtin must be false' using errcode = 'check_violation';
    end if;
    if new.status not in ('published', 'withdrawn') then
      raise exception 'status must be published or withdrawn' using errcode = 'check_violation';
    end if;
  end if;

  -- 「变成 published」时刷新发布时间；客户端不能自己写 published_at。
  if tg_op = 'INSERT' then
    if v_client or new.published_at is null then
      new.published_at := case when new.status = 'published' then now() end;
    end if;
  elsif new.status = 'published' and old.status <> 'published' then
    new.published_at := now();
  elsif v_client then
    new.published_at := old.published_at;
  end if;
  return new;
end $$;

drop trigger if exists community_recipes_guard on public.community_recipes;
create trigger community_recipes_guard
  before insert or update on public.community_recipes
  for each row execute function public.community_recipes_guard();

drop trigger if exists community_recipes_touch_updated_at on public.community_recipes;
create trigger community_recipes_touch_updated_at
  before update on public.community_recipes
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------- public_profiles
-- 社区里展示的昵称 / 头像。现有 profiles 只给本人读，这张表所有人可读；不含邮箱。
create table if not exists public.public_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 20),
  avatar_path text,
  updated_at timestamptz not null default now()
);

alter table public.public_profiles enable row level security;

drop policy if exists public_profiles_read_all on public.public_profiles;
drop policy if exists public_profiles_insert_own on public.public_profiles;
drop policy if exists public_profiles_update_own on public.public_profiles;

create policy public_profiles_read_all on public.public_profiles
  for select to anon, authenticated using (true);
create policy public_profiles_insert_own on public.public_profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy public_profiles_update_own on public.public_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists public_profiles_touch_updated_at on public.public_profiles;
create trigger public_profiles_touch_updated_at
  before update on public.public_profiles
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ recipes 补丁
-- 「存到我的菜谱」的来源：{ communityId, authorNickname }。只加列，不动 RLS。
alter table public.recipes add column if not exists origin jsonb;

-- 私有菜被删（任何设备、任何同步路径）→ 对应社区菜撤回。不改同步代码。
create or replace function public.recipes_withdraw_community()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.community_recipes
     set status = 'withdrawn'
   where author_id = new.user_id
     and source_recipe_id = new.id
     and status = 'published';
  return new;
end $$;

revoke all on function public.recipes_withdraw_community() from public, anon, authenticated;

drop trigger if exists recipes_withdraw_community on public.recipes;
create trigger recipes_withdraw_community
  after update of deleted on public.recipes
  for each row
  when (old.deleted = false and new.deleted = true)
  execute function public.recipes_withdraw_community();

-- ------------------------------------------------------ community-media 桶
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists community_media_read on storage.objects;
drop policy if exists community_media_author_rw on storage.objects;

create policy community_media_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'community-media');

-- 可写 / 可删路径：
--   {community_recipe_id}/…：该行存在、本人是作者、未被下架（withdrawn 也行：客户端先建行再传图）
--   avatars/{auth.uid()}.jpg：本人的公开头像
-- 注意：子查询里必须写 objects.name —— community_recipes 也有 name 列，裸写会被解析成 c.name。
create policy community_media_author_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'community-media' and (
      name = 'avatars/' || auth.uid()::text || '.jpg'
      or exists (
        select 1 from public.community_recipes c
        where c.id::text = (storage.foldername(objects.name))[1]
          and c.author_id = auth.uid()
          and c.status <> 'removed'
      )
    )
  )
  with check (
    bucket_id = 'community-media' and (
      name = 'avatars/' || auth.uid()::text || '.jpg'
      or exists (
        select 1 from public.community_recipes c
        where c.id::text = (storage.foldername(objects.name))[1]
          and c.author_id = auth.uid()
          and c.status <> 'removed'
      )
    )
  );

-- ---------------------------------------------------------- 内置菜 seed
-- 内容抄自 src/data/recipes.ts（共 6 道；steps 存成 [{text}]，与客户端 normalizeSteps 一致）。
-- uuid 写死，客户端可用内置 id（source_recipe_id）或下列常量定位：
--   tomato-pasta   00000000-0000-4000-8000-000000000001
--   avocado-bowl   00000000-0000-4000-8000-000000000002
--   seasonal-salad 00000000-0000-4000-8000-000000000003
--   mushroom-rice  00000000-0000-4000-8000-000000000004
--   pumpkin-soup   00000000-0000-4000-8000-000000000005
--   egg-toast      00000000-0000-4000-8000-000000000006
-- 重复执行时只刷新内容列，不碰 status / 计数 / published_at（管理员下架、点赞数保留）。
insert into public.community_recipes (
  id, author_id, source_recipe_id, builtin,
  name, subtitle, description, minutes, difficulty, calories,
  tags, art, ingredients, steps, heat, tips, step_minutes, cover
) values
  ('00000000-0000-4000-8000-000000000001', null, 'tomato-pasta', true,
   '番茄奶油意面', '酸甜浓郁，一口治愈今天的小疲惫', '酸甜浓郁，一口治愈今天的小疲惫。', 20, '简单', 520,
   '["意面","一锅到底"]'::jsonb, 'pasta',
   '[{"name":"意大利面","qty":100,"unit":"g"},{"name":"小番茄","qty":8,"unit":"颗"},{"name":"淡奶油","qty":50,"unit":"ml"},{"name":"大蒜","qty":2,"unit":"瓣"},{"name":"橄榄油、盐","qty":null,"unit":"适量"}]'::jsonb,
   '[{"text":"煮沸清水，加入少许盐，放入意面煮至八分熟，保留一小碗煮面水。"},{"text":"小番茄对半切开，大蒜切末。"},{"text":"锅中倒入橄榄油，小火炒香蒜末，加入番茄炒到出汁变软。"},{"text":"倒入淡奶油和少量煮面水，小火搅匀，煮出顺滑酱汁。"},{"text":"放入意面拌煮一分钟，用盐调味，装盘即可。"}]'::jsonb,
   '中火', '["留一小碗煮面水，之后能让酱汁挂得更住。","番茄先去皮，酱汁会更细腻顺滑。","蒜末别炒到发黄，闻到香味就够了。","全程小火，奶油容易分离。","关火后再拌 10 秒，酱汁更亮。"]'::jsonb, '[4,2,5,6,3]'::jsonb, null),
  ('00000000-0000-4000-8000-000000000002', null, 'avocado-bowl', true,
   '牛油果能量碗', '清爽开启一天，让每一口都充满元气', '清爽开启一天，让每一口都充满元气。', 10, '简单', 410,
   '["快手","高蛋白"]'::jsonb, 'salad',
   '[{"name":"牛油果","qty":0.5,"unit":"个"},{"name":"熟藜麦","qty":100,"unit":"g"},{"name":"生菜","qty":50,"unit":"g"},{"name":"水煮蛋","qty":1,"unit":"个"},{"name":"柠檬汁、橄榄油","qty":null,"unit":"适量"}]'::jsonb,
   '[{"text":"生菜洗净沥干，牛油果去皮切片，水煮蛋对半切开。"},{"text":"碗中铺上熟藜麦，依次放入生菜、牛油果和鸡蛋。"},{"text":"淋上柠檬汁与橄榄油，撒少许盐和黑胡椒，轻轻拌匀即可。"}]'::jsonb,
   null, '[]'::jsonb, '[]'::jsonb, null),
  ('00000000-0000-4000-8000-000000000003', null, 'seasonal-salad', true,
   '时蔬暖心沙拉', '轻盈也满足，把当季的新鲜装进碗里', '轻盈也满足，把当季的新鲜装进碗里。', 15, '简单', 280,
   '["轻食","当季"]'::jsonb, 'salad',
   '[{"name":"西兰花","qty":100,"unit":"g"},{"name":"南瓜","qty":100,"unit":"g"},{"name":"生菜","qty":50,"unit":"g"},{"name":"橄榄油、盐","qty":null,"unit":"适量"}]'::jsonb,
   '[{"text":"西兰花和生菜洗净，南瓜去皮切成小块。"},{"text":"南瓜上锅蒸熟，西兰花焯熟后沥干水分。"},{"text":"全部蔬菜装碗，加入橄榄油与少许盐拌匀，趁温热享用。"}]'::jsonb,
   null, '[]'::jsonb, '[]'::jsonb, null),
  ('00000000-0000-4000-8000-000000000004', null, 'mushroom-rice', true,
   '香菇鸡肉焖饭', '一锅端上桌的温暖主食', '一锅端上桌的温暖主食，米饭吸满鸡汤香气。', 35, '中等', 610,
   '["一锅到底","主食"]'::jsonb, 'rice',
   '[{"name":"大米","qty":150,"unit":"g"},{"name":"鸡腿肉","qty":150,"unit":"g"},{"name":"干香菇","qty":4,"unit":"朵"},{"name":"胡萝卜","qty":0.5,"unit":"根"},{"name":"生抽、老抽","qty":2,"unit":"勺"}]'::jsonb,
   '[{"text":"香菇泡发切片，鸡腿肉切块，胡萝卜切丁。"},{"text":"锅中少油，将鸡肉煎至表面金黄，加入香菇和胡萝卜炒香。"},{"text":"倒入生抽、老抽翻匀，加入大米和泡香菇的水，水量与平时煮饭相同。"},{"text":"全部转入电饭煲，按普通煮饭键，跳闸后焖十分钟再拌匀。"}]'::jsonb,
   null, '[]'::jsonb, '[]'::jsonb, null),
  ('00000000-0000-4000-8000-000000000005', null, 'pumpkin-soup', true,
   '南瓜浓汤', '绵密顺口，一碗下肚胃里暖暖的', '绵密顺口，一碗下肚胃里暖暖的。', 25, '简单', 230,
   '["汤","暖胃"]'::jsonb, 'soup',
   '[{"name":"南瓜","qty":300,"unit":"g"},{"name":"洋葱","qty":0.25,"unit":"个"},{"name":"牛奶","qty":150,"unit":"ml"},{"name":"黄油","qty":10,"unit":"g"}]'::jsonb,
   '[{"text":"南瓜去皮切块，洋葱切小丁。"},{"text":"锅中融化黄油，炒香洋葱至透明，加入南瓜翻炒。"},{"text":"加水没过食材，煮十五分钟至南瓜软烂。"},{"text":"倒入料理机打至细腻，倒回锅中加入牛奶小火加热，用盐调味。"}]'::jsonb,
   null, '[]'::jsonb, '[]'::jsonb, null),
  ('00000000-0000-4000-8000-000000000006', null, 'egg-toast', true,
   '一人食快手早午餐', '十分钟搞定的松弛感', '十分钟搞定的松弛感，吐司配煎蛋和小番茄。', 8, '简单', 340,
   '["快手","早午餐"]'::jsonb, 'toast',
   '[{"name":"全麦吐司","qty":2,"unit":"片"},{"name":"鸡蛋","qty":2,"unit":"个"},{"name":"小番茄","qty":6,"unit":"颗"},{"name":"黄油","qty":10,"unit":"g"}]'::jsonb,
   '[{"text":"吐司放入烤箱或平底锅，烤到两面微脆。"},{"text":"平底锅融化黄油，将鸡蛋煎至喜欢的熟度。"},{"text":"小番茄对半切开，稍微煎一下出汁。"},{"text":"把煎蛋和番茄放到吐司上，撒盐和黑胡椒即可。"}]'::jsonb,
   null, '[]'::jsonb, '[]'::jsonb, null)
on conflict (id) do update set
  source_recipe_id = excluded.source_recipe_id,
  builtin = excluded.builtin,
  name = excluded.name,
  subtitle = excluded.subtitle,
  description = excluded.description,
  minutes = excluded.minutes,
  difficulty = excluded.difficulty,
  calories = excluded.calories,
  tags = excluded.tags,
  art = excluded.art,
  ingredients = excluded.ingredients,
  steps = excluded.steps,
  heat = excluded.heat,
  tips = excluded.tips,
  step_minutes = excluded.step_minutes,
  cover = excluded.cover;

-- ================================================================= 后半：互动
-- 计数触发器都是 security definer：以 owner 身份更新 like_count / comment_count，
-- 越过 community_recipes_guard（它只约束 anon / authenticated）。

-- ---------------------------------------------------------- community_likes
create table if not exists public.community_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  community_recipe_id uuid not null references public.community_recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, community_recipe_id)
);
create index if not exists community_likes_recipe_idx
  on public.community_likes (community_recipe_id);

alter table public.community_likes enable row level security;

drop policy if exists community_likes_read_all on public.community_likes;
drop policy if exists community_likes_insert_own on public.community_likes;
drop policy if exists community_likes_delete_own on public.community_likes;

create policy community_likes_read_all on public.community_likes
  for select to anon, authenticated using (true);
create policy community_likes_insert_own on public.community_likes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.community_recipes c
                where c.id = community_recipe_id and c.status = 'published')
  );
create policy community_likes_delete_own on public.community_likes
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.community_recipes c
                where c.id = community_recipe_id and c.status = 'published')
  );

create or replace function public.community_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.community_recipes
       set like_count = like_count + 1
     where id = new.community_recipe_id;
    return new;
  else
    update public.community_recipes
       set like_count = greatest(like_count - 1, 0)
     where id = old.community_recipe_id;
    return old;
  end if;
end $$;

revoke all on function public.community_likes_count() from public, anon, authenticated;

drop trigger if exists community_likes_count on public.community_likes;
create trigger community_likes_count
  after insert or delete on public.community_likes
  for each row execute function public.community_likes_count();

-- ------------------------------------------------------- community_comments
create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  community_recipe_id uuid not null references public.community_recipes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.community_comments (id) on delete cascade,
  body text not null,
  deleted boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  -- char_length 按 Unicode 码点计；删除后 body 为空串，不再校验长度
  constraint community_comments_body_len
    check (deleted or char_length(btrim(body)) between 1 and 500)
);
create index if not exists community_comments_recipe_idx
  on public.community_comments (community_recipe_id, created_at);
create index if not exists community_comments_parent_idx
  on public.community_comments (parent_id) where parent_id is not null;

alter table public.community_comments enable row level security;

-- select 策略要看父评论是否 hidden；直接在策略里查本表会触发 RLS 递归，
-- 所以放进 security definer 函数。
create or replace function public.community_comment_visible(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.community_comments where id = p_id and hidden = false)
$$;

revoke all on function public.community_comment_visible(uuid) from public;
grant execute on function public.community_comment_visible(uuid) to anon, authenticated;

drop policy if exists community_comments_read on public.community_comments;
drop policy if exists community_comments_insert_own on public.community_comments;
drop policy if exists community_comments_delete on public.community_comments;

create policy community_comments_read on public.community_comments
  for select to anon, authenticated
  using (
    hidden = false
    and exists (select 1 from public.community_recipes c
                where c.id = community_recipe_id and c.status = 'published')
    and (parent_id is null or public.community_comment_visible(parent_id))
  );
create policy community_comments_insert_own on public.community_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.community_recipes c
                where c.id = community_recipe_id and c.status = 'published')
  );
-- 评论者本人或菜的作者可「删除」（软删）；能改哪些列由下面的 guard 触发器限制。
create policy community_comments_delete on public.community_comments
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.community_recipes c
               where c.id = community_recipe_id and c.author_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    or exists (select 1 from public.community_recipes c
               where c.id = community_recipe_id and c.author_id = auth.uid())
  );

-- insert：只允许一层回复，且父评论属于同一道菜；客户端不能直接插入 deleted / hidden。
-- update：客户端只能把 deleted 从 false 改成 true，其余列不变；service_role / postgres 可改 hidden。
-- 任何角色把 deleted 改成 true 时都清空 body。
-- 不是 security definer（要靠 current_user 区分客户端）；客户端看不到的父评论（hidden / 菜已撤回）
-- 查不到，按「父评论不存在」报错。
create or replace function public.community_comments_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_client boolean := current_user in ('anon', 'authenticated');
  v_parent public.community_comments%rowtype;
begin
  if tg_op = 'INSERT' then
    if v_client then
      new.deleted := false;
      new.hidden := false;
    end if;
    if new.parent_id is not null then
      select * into v_parent from public.community_comments where id = new.parent_id;
      if not found then
        raise exception 'parent comment % not found', new.parent_id using errcode = 'foreign_key_violation';
      end if;
      if v_parent.parent_id is not null then
        raise exception 'replies can only target top-level comments' using errcode = 'check_violation';
      end if;
      if v_parent.community_recipe_id <> new.community_recipe_id then
        raise exception 'parent comment belongs to another recipe' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  if v_client then
    if not (old.deleted = false and new.deleted = true)
       or new.id is distinct from old.id
       or new.community_recipe_id is distinct from old.community_recipe_id
       or new.user_id is distinct from old.user_id
       or new.parent_id is distinct from old.parent_id
       or new.body is distinct from old.body
       or new.hidden is distinct from old.hidden
       or new.created_at is distinct from old.created_at then
      raise exception 'comments can only be deleted' using errcode = 'check_violation';
    end if;
  end if;
  if new.deleted and not old.deleted then
    new.body := '';
  end if;
  return new;
end $$;

revoke all on function public.community_comments_guard() from public, anon, authenticated;

drop trigger if exists community_comments_guard on public.community_comments;
create trigger community_comments_guard
  before insert or update on public.community_comments
  for each row execute function public.community_comments_guard();

create or replace function public.community_comments_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not new.deleted then
      update public.community_recipes
         set comment_count = comment_count + 1
       where id = new.community_recipe_id;
    end if;
  elsif new.deleted and not old.deleted then
    update public.community_recipes
       set comment_count = greatest(comment_count - 1, 0)
     where id = new.community_recipe_id;
  end if;
  return new;
end $$;

revoke all on function public.community_comments_count() from public, anon, authenticated;

drop trigger if exists community_comments_count on public.community_comments;
create trigger community_comments_count
  after insert or update of deleted on public.community_comments
  for each row execute function public.community_comments_count();

-- -------------------------------------------------------- community_reports
create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  community_recipe_id uuid references public.community_recipes (id) on delete cascade,
  comment_id uuid references public.community_comments (id) on delete cascade,
  reason text not null check (reason in ('ad', 'unfriendly', 'irrelevant', 'other')),
  created_at timestamptz not null default now(),
  resolved boolean not null default false,
  constraint community_reports_one_target
    check ((community_recipe_id is null) <> (comment_id is null))
);
-- 同一人对同一目标只能举报一次（菜和评论的 uuid 不会撞）。
create unique index if not exists community_reports_reporter_target_uidx
  on public.community_reports (reporter_id, (coalesce(community_recipe_id, comment_id)));

alter table public.community_reports enable row level security;

drop policy if exists community_reports_insert_own on public.community_reports;
create policy community_reports_insert_own on public.community_reports
  for insert to authenticated with check (reporter_id = auth.uid());
-- 不给 select / update / delete：管理员在 Dashboard（postgres / service_role）处理。
