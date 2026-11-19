-- 楼中楼「回复 @某人」：记录一条回复是在回谁（回复仍然只有一层，挂在顶层评论下）。
-- 幂等，可重复执行。

alter table public.community_comments
  add column if not exists reply_to_user_id uuid references auth.users (id) on delete set null;

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
      new.created_at := now();   -- 评论按时间排序，客户端不能伪造
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
    -- 「回复 @某人」：只能指向同一楼里（顶层评论或它下面的回复）发过言的人。
    if new.reply_to_user_id is not null then
      if new.parent_id is null then
        raise exception 'reply_to_user_id requires parent_id' using errcode = 'check_violation';
      end if;
      if not exists (
        select 1 from public.community_comments c
        where (c.id = new.parent_id or c.parent_id = new.parent_id) and c.user_id = new.reply_to_user_id
      ) then
        raise exception 'reply target is not in this thread' using errcode = 'check_violation';
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
       or new.reply_to_user_id is distinct from old.reply_to_user_id
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
