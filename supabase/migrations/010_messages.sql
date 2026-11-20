-- 社交第二期：私信和私人群聊的会话、成员、消息。
-- 规则都在库里：只有成员能读会话和消息、只能以自己身份发；私信的陌生人限制、拉黑、发送频率由触发器强制。
-- 建群 / 邀请 / 退群等群聊函数在后续迁移里补上；本迁移只建表和私信相关函数。

-- ------------------------------------------------------------ conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  name text,
  owner_id uuid references auth.users (id) on delete set null,
  -- 私信两端排序后拼成的键，保证同一对用户只有一个私信会话。
  direct_key text unique,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conversations_kind_shape check (
    (kind = 'direct' and name is null and direct_key is not null)
    or (kind = 'group' and direct_key is null and name is not null and char_length(btrim(name)) between 1 and 30)
  )
);

-- ---------------------------------------------------- conversation_members
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

-- ----------------------------------------------------------------- messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- 账号删除后消息保留，发送者置空（显示为「已注销用户」）。
  sender_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at desc);

-- ------------------------------------------------- is_conversation_member
-- security definer：RLS 里查成员表时不再递归套用成员表自己的 RLS。
create or replace function public.is_conversation_member(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversation_members cm
     where cm.conversation_id = conv and cm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;

-- ---------------------------------------------------------------------- RLS
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists conversations_read_member on public.conversations;
drop policy if exists conversation_members_read_member on public.conversation_members;
drop policy if exists messages_read_member on public.messages;
drop policy if exists messages_insert_member on public.messages;

-- 只有会话成员能读会话、成员和消息；anon 不可见。
create policy conversations_read_member on public.conversations
  for select to authenticated using (public.is_conversation_member(id));
create policy conversation_members_read_member on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy messages_read_member on public.messages
  for select to authenticated using (public.is_conversation_member(conversation_id));
-- 只有成员能发，发送者必须是自己。
create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

-- 会话和成员只通过函数创建 / 修改；消息只增不改不删。撤掉表级权限（否则 RLS 只会静默影响 0 行）。
revoke insert, update, delete on public.conversations from anon, authenticated;
revoke insert, update, delete on public.conversation_members from anon, authenticated;
revoke update, delete on public.messages from anon, authenticated;

-- ------------------------------------------------- 发消息前的规则检查
-- 顺序：频率 → 私信的拉黑 → 私信的陌生人限制。security definer：要读对方的关注 / 拉黑记录。
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conv_kind text;
  peer uuid;
begin
  -- 时间由库决定，不能靠回填旧时间绕过频率限制。
  new.created_at := now();

  -- 冒充他人或不是成员：交给 RLS 拒绝（42501），这里不提前报业务错误。
  if new.sender_id is null
     or (auth.uid() is not null and new.sender_id <> auth.uid())
     or not exists (
       select 1 from public.conversation_members cm
        where cm.conversation_id = new.conversation_id and cm.user_id = new.sender_id
     ) then
    return new;
  end if;

  -- 每人每分钟 30 条，跨所有会话合计。
  if (
    select count(*) from public.messages m
     where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select c.kind into conv_kind from public.conversations c where c.id = new.conversation_id;
  if conv_kind <> 'direct' then
    return new;
  end if;

  select cm.user_id into peer
    from public.conversation_members cm
   where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id
   limit 1;
  if peer is null then
    return new;
  end if;

  if exists (
    select 1 from public.blocks b
     where (b.blocker_id = new.sender_id and b.blocked_id = peer)
        or (b.blocker_id = peer and b.blocked_id = new.sender_id)
  ) then
    raise exception 'recipient_unavailable' using errcode = 'P0001';
  end if;

  -- 对方在本会话说过话 → 永久不限制；否则对方当前关注我 → 不限制；否则最多 1 条。
  if exists (
    select 1 from public.messages m
     where m.conversation_id = new.conversation_id and m.sender_id = peer
  ) then
    return new;
  end if;
  if exists (
    select 1 from public.follows f where f.follower_id = peer and f.followee_id = new.sender_id
  ) then
    return new;
  end if;
  if exists (
    select 1 from public.messages m
     where m.conversation_id = new.conversation_id and m.sender_id = new.sender_id
  ) then
    raise exception 'stranger_limit' using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke all on function public.messages_before_insert() from public, anon, authenticated;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- 新消息更新会话的 last_message_at（调用者对 conversations 没有 update 权限）。
create or replace function public.messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;

revoke all on function public.messages_touch_conversation() from public, anon, authenticated;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.messages_touch_conversation();

-- -------------------------------------------------------------- open_direct
-- 找到或创建和 target 的私信会话。不要求关注；任一方向拉黑则失败。
create or replace function public.open_direct(target uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  key text;
  conv uuid;
begin
  if me is null or target is null or target = me
     or not exists (select 1 from auth.users u where u.id = target) then
    raise exception 'invalid' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.blocks b
     where (b.blocker_id = me and b.blocked_id = target)
        or (b.blocker_id = target and b.blocked_id = me)
  ) then
    raise exception 'recipient_unavailable' using errcode = 'P0001';
  end if;

  key := least(me, target)::text || ':' || greatest(me, target)::text;

  select c.id into conv from public.conversations c where c.direct_key = key;
  if conv is not null then
    return conv;
  end if;

  insert into public.conversations (kind, direct_key)
  values ('direct', key)
  on conflict (direct_key) do nothing
  returning id into conv;

  if conv is null then
    -- 并发时另一方刚建好（连同成员一起提交），直接用它。
    select c.id into conv from public.conversations c where c.direct_key = key;
    return conv;
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (conv, me, 'member'), (conv, target, 'member');

  return conv;
end $$;

revoke all on function public.open_direct(uuid) from public, anon;
grant execute on function public.open_direct(uuid) to authenticated;

-- ---------------------------------------------------------------- mark_read
create or replace function public.mark_read(conv uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = conv and user_id = auth.uid();
  if not found then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.mark_read(uuid) from public, anon;
grant execute on function public.mark_read(uuid) to authenticated;

-- --------------------------------------------------------- my_conversations
-- 我所在的全部会话，一次拿到预览和未读数。按调用者权限执行（RLS 只放出我所在的会话）。
-- 群聊里我拉黑的人发的消息不计未读、也不作预览（客户端也会过滤掉）；私信不排除。
create or replace function public.my_conversations()
returns table (
  id uuid,
  kind text,
  name text,
  last_message_at timestamptz,
  last_body text,
  last_sender_id uuid,
  unread int,
  peer_id uuid,
  member_count int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.kind,
    c.name,
    c.last_message_at,
    lm.body,
    lm.sender_id,
    (select count(*)::int
       from public.messages m
      where m.conversation_id = c.id
        and m.created_at > me.last_read_at
        and m.sender_id is distinct from auth.uid()
        and (c.kind = 'direct' or not exists (
          select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = m.sender_id
        ))),
    case when c.kind = 'direct' then (
      select cm.user_id from public.conversation_members cm
       where cm.conversation_id = c.id and cm.user_id <> auth.uid()
       limit 1
    ) end,
    (select count(*)::int from public.conversation_members cm where cm.conversation_id = c.id)
  from public.conversations c
  join public.conversation_members me on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select m.body, m.sender_id
      from public.messages m
     where m.conversation_id = c.id
       and (c.kind = 'direct' or not exists (
         select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = m.sender_id
       ))
     order by m.created_at desc, m.id desc
     limit 1
  ) lm on true
  order by c.last_message_at desc, c.id;
$$;

revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- ---------------------------------------------------------------- Realtime
-- 加入 supabase_realtime publication；已在里面就跳过，可重复执行。
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['conversations', 'conversation_members', 'messages'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
