-- 社交第一期：关注、拉黑、举报用户。
-- 规则都在库里：只能以自己身份关注/拉黑；任一方拉黑后双方不能互相关注；拉黑时删除双方已有的关注。

-- ------------------------------------------------------------------ follows
create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id, created_at desc);
create index if not exists follows_follower_created_idx on public.follows (follower_id, created_at desc);

alter table public.follows enable row level security;

drop policy if exists follows_read_authenticated on public.follows;
drop policy if exists follows_insert_own on public.follows;
drop policy if exists follows_delete_own on public.follows;

-- 关注 / 粉丝列表对登录用户公开；anon 不可见。
create policy follows_read_authenticated on public.follows
  for select to authenticated using (true);
create policy follows_insert_own on public.follows
  for insert to authenticated with check (follower_id = auth.uid());
create policy follows_delete_own on public.follows
  for delete to authenticated using (follower_id = auth.uid());

-- ------------------------------------------------------------------- blocks
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

drop policy if exists blocks_read_own on public.blocks;
drop policy if exists blocks_insert_own on public.blocks;
drop policy if exists blocks_delete_own on public.blocks;

-- 拉黑关系只有拉黑者自己能看到。
create policy blocks_read_own on public.blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert_own on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy blocks_delete_own on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- 任一方向存在拉黑 → 不能关注。security definer：调用者读不到对方的拉黑记录。
create or replace function public.follows_check_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.blocks b
     where (b.blocker_id = new.follower_id and b.blocked_id = new.followee_id)
        or (b.blocker_id = new.followee_id and b.blocked_id = new.follower_id)
  ) then
    raise exception 'follow_blocked' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.follows_check_block() from public, anon, authenticated;

drop trigger if exists follows_check_block on public.follows;
create trigger follows_check_block
  before insert on public.follows
  for each row execute function public.follows_check_block();

-- 拉黑时删除双方之间的关注（对方那条调用者本无权删）。
create or replace function public.blocks_drop_follows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;

revoke all on function public.blocks_drop_follows() from public, anon, authenticated;

drop trigger if exists blocks_drop_follows on public.blocks;
create trigger blocks_drop_follows
  after insert on public.blocks
  for each row execute function public.blocks_drop_follows();

-- 关注 / 拉黑关系只增删，不改：撤掉表级 update 权限（否则 RLS 只会静默更新 0 行）。
revoke update on public.follows from anon, authenticated;
revoke update on public.blocks from anon, authenticated;

-- ------------------------------------------------------------- social_stats
-- 关注数、粉丝数、我是否关注 Ta、Ta 是否关注我。按调用者权限执行（follows 对登录用户可读）。
create or replace function public.social_stats(target uuid)
returns table (following_count int, follower_count int, i_follow boolean, follows_me boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    (select count(*)::int from public.follows f where f.follower_id = target),
    (select count(*)::int from public.follows f where f.followee_id = target),
    exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = target),
    exists (select 1 from public.follows f where f.follower_id = target and f.followee_id = auth.uid());
$$;

revoke all on function public.social_stats(uuid) from public, anon;
grant execute on function public.social_stats(uuid) to authenticated;

-- ------------------------------------------------------- 举报用户
alter table public.community_reports
  add column if not exists reported_user_id uuid references auth.users (id) on delete cascade;

alter table public.community_reports drop constraint if exists community_reports_one_target;
alter table public.community_reports add constraint community_reports_one_target
  check (num_nonnulls(community_recipe_id, comment_id, reported_user_id) = 1);

alter table public.community_reports drop constraint if exists community_reports_not_self;
alter table public.community_reports add constraint community_reports_not_self
  check (reported_user_id is null or reported_user_id <> reporter_id);

-- 同一人对同一目标只能举报一次（菜、评论、用户的 uuid 不会撞）。
drop index if exists public.community_reports_reporter_target_uidx;
create unique index community_reports_reporter_target_uidx
  on public.community_reports (reporter_id, (coalesce(community_recipe_id, comment_id, reported_user_id)));
