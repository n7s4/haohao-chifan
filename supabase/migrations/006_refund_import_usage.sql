-- 配额「先扣后退」：解析失败（不像菜谱 / 没步骤 / 超时 / key 无效）不该吃掉用户的一次机会。
--
-- 退还必须服务端做，不能给 authenticated：开了就等于用户可以反复退款把 count 清零，
-- 限流直接失效。所以只 grant 给 service_role，user_id 由 Edge Function 显式传（那里拿得到
-- 已验证的 JWT sub），客户端碰不到这个函数。

create or replace function public.refund_import_usage(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.import_usage
     set count = greatest(count - 1, 0)
   where user_id = p_user_id
     and day = (now() at time zone 'Asia/Singapore')::date;
end;
$$;

revoke all on function public.refund_import_usage(uuid) from public, anon, authenticated;
grant execute on function public.refund_import_usage(uuid) to service_role;
