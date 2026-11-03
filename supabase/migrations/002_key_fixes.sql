-- 好好吃饭 · 002 schema 修正（幂等，可重复执行）
-- 背景：001 里 recipes / shopping_items 的 text 主键是全局唯一，软删后重建计划的唯一约束也会撞。
-- 做法：文本 id 改为 (user_id, id) 复合主键；plan 的唯一性只约束未删除行。

-- ---------------------------------------------------------------- recipes
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipes'::regclass and conname = 'recipes_pkey'
  ) then
    alter table public.recipes drop constraint recipes_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recipes'::regclass and contype = 'p'
  ) then
    alter table public.recipes add constraint recipes_pkey primary key (user_id, id);
  end if;
end $$;

-- ---------------------------------------------------------- shopping_items
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.shopping_items'::regclass and conname = 'shopping_items_pkey'
  ) then
    alter table public.shopping_items drop constraint shopping_items_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shopping_items'::regclass and contype = 'p'
  ) then
    alter table public.shopping_items add constraint shopping_items_pkey primary key (user_id, id);
  end if;
end $$;

-- ------------------------------------------------------- meal_plan_entries
-- 同一用户同一天同一个餐位，只允许一条「未删除」记录；删掉的那条留着做 tombstone。
alter table public.meal_plan_entries
  drop constraint if exists meal_plan_entries_user_id_day_key_slot_key;

drop index if exists public.meal_plan_entries_live_slot_uidx;
create unique index meal_plan_entries_live_slot_uidx
  on public.meal_plan_entries (user_id, day_key, slot)
  where deleted = false;

-- ------------------------------------------------------------- updated_at
-- 服务端兜底：任何 update 都刷新 updated_at，避免客户端时钟不准导致后写赢判断错乱。
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'recipes', 'meal_plan_entries',
    'shopping_items', 'media_assets'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end $$;

-- recipe_prefs 主键是 (user_id, recipe_id)，没有 id 列，单独处理 updated_at 也已覆盖
drop trigger if exists recipe_prefs_touch_updated_at on public.recipe_prefs;
create trigger recipe_prefs_touch_updated_at
  before update on public.recipe_prefs
  for each row execute function public.touch_updated_at();
