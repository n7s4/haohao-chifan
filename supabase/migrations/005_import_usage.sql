-- AI 导入的每日配额。
--
-- 为什么不是一个内存计数器：Edge Function 是无状态多实例的，冷启动就清零、
-- 并发各自数各自的，等于没限。这里落一张表，用 (user_id, day) 做唯一键自增。
-- 表本身不开任何 policy —— 只有下面的 definer 函数能读写，
-- 否则用户可以用自己的 JWT 把 count 改回 0。

create table if not exists public.import_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default (now() at time zone 'Asia/Singapore')::date,
  count integer not null default 0,
  primary key (user_id, day)
);

alter table public.import_usage enable row level security;

-- 早期版本带 p_limit 入参，若已建过一并清掉，避免同名不同签名并存。
drop function if exists public.bump_import_usage(integer);

-- 配额和「今天」都由函数自己算：user 从 auth.uid() 取、日子从 now() 取、
-- 上限写死。没有任何一个是入参，客户端拨不动。
create or replace function public.bump_import_usage()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
  v_limit constant integer := 20;
  v_day date := (now() at time zone 'Asia/Singapore')::date;
begin
  if v_uid is null then
    return -1;
  end if;

  insert into public.import_usage (user_id, day, count)
  values (v_uid, v_day, 1)
  on conflict (user_id, day) do update set count = public.import_usage.count + 1
  returning count into v_count;

  if v_count > v_limit then
    return 0;
  end if;
  return v_limit - v_count;
end;
$$;

revoke all on function public.bump_import_usage() from public, anon;
grant execute on function public.bump_import_usage() to authenticated;
