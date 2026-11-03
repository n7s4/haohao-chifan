-- 好好吃饭 · 初始 schema (Supabase / Postgres)
-- 所有业务表按 user_id 隔离，RLS 一律 auth.uid() = user_id。
-- 同步策略：客户端先写本地，再推云端；冲突按 updated_at 后写赢。

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- recipes
-- 用户自建/修改的菜谱。内置 5 道菜仍走客户端常量，这里只存用户数据。
create table if not exists public.recipes (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
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
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipes_user_updated_idx on public.recipes (user_id, updated_at desc);

-- ------------------------------------------------------- meal_plan_entries
create table if not exists public.meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_key date not null,          -- 周一，如 2026-10-19
  day_key date not null,           -- 具体哪天
  slot text not null check (slot in ('早餐', '午餐', '晚餐')),
  recipe_id text,
  servings int not null default 1 check (servings between 1 and 6),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day_key, slot)
);
create index if not exists plan_user_week_idx on public.meal_plan_entries (user_id, week_key);

-- ------------------------------------------------------------ shopping_items
create table if not exists public.shopping_items (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  week_key date not null,
  name text not null,
  qty numeric,
  unit text not null default '',
  checked boolean not null default false,
  sources jsonb not null default '[]'::jsonb,
  kind text not null default 'derived' check (kind in ('derived', 'manual')),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_user_week_idx on public.shopping_items (user_id, week_key);

-- -------------------------------------------------------------- recipe_prefs
create table if not exists public.recipe_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id text not null,
  rating int check (rating between 1 and 5),
  servings int check (servings between 1 and 6),
  favorite boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

-- ---------------------------------------------------------------- cook_log
create table if not exists public.cook_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id text not null,
  cooked_on date not null,
  created_at timestamptz not null default now(),
  unique (user_id, recipe_id, cooked_on)
);
create index if not exists cook_log_user_date_idx on public.cook_log (user_id, cooked_on desc);

-- ------------------------------------------------------------- media_assets
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id text,
  step_index int,
  kind text not null check (kind in ('photo', 'video')),
  storage_path text not null,
  duration_ms int,
  width int,
  height int,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists media_user_recipe_idx on public.media_assets (user_id, recipe_id);

-- ------------------------------------------------------------------- RLS
alter table public.profiles           enable row level security;
alter table public.recipes            enable row level security;
alter table public.meal_plan_entries  enable row level security;
alter table public.shopping_items     enable row level security;
alter table public.recipe_prefs       enable row level security;
alter table public.cook_log           enable row level security;
alter table public.media_assets       enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'recipes', 'meal_plan_entries', 'shopping_items',
    'recipe_prefs', 'cook_log', 'media_assets'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner_all', t
    );
  end loop;
end $$;

-- profiles 主键列名是 id（没有 user_id），单独一条策略
drop policy if exists profiles_owner_all on public.profiles;
create policy profiles_owner_all on public.profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- 新用户注册时自动建 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------- storage
insert into storage.buckets (id, name, public)
values ('recipe-media', 'recipe-media', false)
on conflict (id) do nothing;

drop policy if exists recipe_media_owner_rw on storage.objects;
create policy recipe_media_owner_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'recipe-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recipe-media' and (storage.foldername(name))[1] = auth.uid()::text);
