-- 社区菜谱 / 公开资料 / 公开桶 / 私有表补丁（007_community.sql 前半）
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- 测试用户：A、B（直接写 auth.users；handle_new_user 会顺带建 profiles）
insert into auth.users (id, instance_id, aud, role, email) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com');

-- ------------------------------------------------------------------ schema
select has_table('public', 'community_recipes', 'community_recipes 存在');
select has_table('public', 'public_profiles', 'public_profiles 存在');
select has_column('public', 'recipes', 'origin', 'recipes.origin 存在');
select col_type_is('public', 'recipes', 'origin', 'jsonb', 'recipes.origin 是 jsonb');
select col_type_is('public', 'community_recipes', 'steps', 'jsonb', '菜谱列与 recipes 同类型');

-- ------------------------------------------------------------ 内置菜 seed
set local role anon;
select is((select count(*)::int from public.community_recipes where builtin), 6, 'anon 可见全部内置菜（src/data/recipes.ts 共 6 道）');
select is(
  (select author_id from public.community_recipes where builtin and source_recipe_id = 'tomato-pasta'),
  null, '内置菜 author_id 为 null');
select is(
  (select step_minutes from public.community_recipes where source_recipe_id = 'tomato-pasta'),
  '[4, 2, 5, 6, 3]'::jsonb, '内置菜 step_minutes 照抄');
reset role;

-- ------------------------------------------------- 发布 / 可见性 / 列保护
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.community_recipes (id, author_id, source_recipe_id, name, like_count, comment_count)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'r1', '番茄炒蛋', 99, 7);
select is((select like_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0, 'insert 时 like_count 被强制为 0');
select is((select comment_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0, 'insert 时 comment_count 被强制为 0');
select isnt((select published_at from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), null, '发布时写入 published_at');
-- 客户端不能伪造时间戳（「最新」排序靠它们）
insert into public.community_recipes (id, author_id, source_recipe_id, name, created_at, published_at)
values ('aaaaaaaa-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'r5', '穿越', '2999-01-01', '2999-01-01');
select is((select created_at from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000005'), now(), 'insert 时 created_at 由服务端写');
select is((select published_at from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000005'), now(), 'insert 时 published_at 由服务端写');
update public.community_recipes set created_at = '2999-01-01', published_at = '2999-01-01' where id = 'aaaaaaaa-0000-4000-8000-000000000005';
select is((select created_at from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000005'), now(), 'update 不能改 created_at');
select is((select published_at from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000005'), now(), 'update 不能改 published_at');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 1, 'B 可见 A 发布的菜');
with u as (update public.community_recipes set name = '被改了' where id = 'aaaaaaaa-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'B 更新 A 的行 → 0 行') from u;
select throws_ok(
  $$insert into public.community_recipes (author_id, source_recipe_id, name) values ('11111111-1111-4111-8111-111111111111', 'fake', '冒名')$$,
  '42501', null, 'B 不能以 A 的名义插入');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select name from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), '番茄炒蛋', 'B 的更新没有生效');
update public.community_recipes set like_count = 50, comment_count = 50 where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is((select like_count + comment_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0, 'update 不能改计数');
select throws_ok(
  $$insert into public.community_recipes (author_id, source_recipe_id, name, builtin) values ('11111111-1111-4111-8111-111111111111', 'r9', '假内置', true)$$,
  '23514', null, '客户端不能插 builtin = true');
select throws_ok(
  $$insert into public.community_recipes (author_id, source_recipe_id, name) values ('11111111-1111-4111-8111-111111111111', 'r1', '重复')$$,
  '23505', null, '同一作者同一私有菜只能有一条');
select lives_ok(
  $$insert into public.community_recipes (id, author_id, source_recipe_id, name, status) values ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'r2', '先占位', 'withdrawn')$$,
  '作者可直接插入 withdrawn 行（先建行后传图）');
select is((select published_at from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000002'), null, 'withdrawn 行没有 published_at');

update public.community_recipes set status = 'withdrawn' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is((select count(*)::int from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 1, '撤回后 A 仍可见');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0, '撤回后 B 不可见');
set local role anon;
select is((select count(*)::int from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 0, '撤回后 anon 不可见');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$update public.community_recipes set status = 'removed' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', null, '作者不能把状态改成 removed');

-- 管理员下架后，作者不能再动这一行
reset role;
update public.community_recipes set status = 'removed' where id = 'aaaaaaaa-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$update public.community_recipes set status = 'published' where id = 'aaaaaaaa-0000-4000-8000-000000000002'$$,
  '23514', null, 'removed 的行作者不能改');

-- --------------------------------------------- 私有菜删除 → 社区菜撤回
update public.community_recipes set status = 'published' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into public.recipes (id, user_id, name) values ('r1', '11111111-1111-4111-8111-111111111111', '番茄炒蛋');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
insert into public.recipes (id, user_id, name) values ('r1', '22222222-2222-4222-8222-222222222222', 'B 的同名菜');
insert into public.community_recipes (id, author_id, source_recipe_id, name) values ('aaaaaaaa-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'r1', 'B 的同名菜');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
update public.recipes set deleted = true where id = 'r1';
select is((select status from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'withdrawn', '私有菜删除后社区行变 withdrawn');
select is((select status from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000003'), 'published', '只撤回本人的那条');

-- ----------------------------------------------------------- public_profiles
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.public_profiles (user_id, nickname) values ('11111111-1111-4111-8111-111111111111', '吃饭的人1234');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select nickname from public.public_profiles where user_id = '11111111-1111-4111-8111-111111111111'), '吃饭的人1234', 'B 能读 A 的昵称');
with u as (update public.public_profiles set nickname = '坏人' where user_id = '11111111-1111-4111-8111-111111111111' returning 1)
select is(count(*)::int, 0, 'B 改 A 的昵称 → 0 行') from u;
select throws_ok(
  $$insert into public.public_profiles (user_id, nickname) values ('22222222-2222-4222-8222-222222222222', '   ')$$,
  '23514', null, '空白昵称被拒');
select throws_ok(
  $$insert into public.public_profiles (user_id, nickname) values ('22222222-2222-4222-8222-222222222222', repeat('长', 21))$$,
  '23514', null, '超过 20 字的昵称被拒');

-- ------------------------------------------------------- community-media 桶
reset role;
select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'community-media'$$,
  $$values (true, 5242880::bigint, array['image/jpeg','image/png','image/webp'])$$,
  'community-media 桶配置');
-- W：A 的 withdrawn 行（先建行后传图）
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.community_recipes (id, author_id, source_recipe_id, name, status) values ('aaaaaaaa-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'r3', '传图中', 'withdrawn');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('community-media', 'aaaaaaaa-0000-4000-8000-000000000004/img1.jpg')$$,
  '作者可往自己社区菜目录写图（withdrawn 也行）');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('community-media', 'aaaaaaaa-0000-4000-8000-000000000002/img1.jpg')$$,
  '42501', null, '已下架的社区菜目录不能写');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('community-media', 'avatars/11111111-1111-4111-8111-111111111111.jpg')$$,
  '本人可写自己的公开头像');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('community-media', 'avatars/22222222-2222-4222-8222-222222222222.jpg')$$,
  '42501', null, '不能写别人的公开头像');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('community-media', 'aaaaaaaa-0000-4000-8000-000000000004/img2.jpg')$$,
  '42501', null, 'B 不能往 A 的社区菜目录写图');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'community-media'),
  0, 'B 列不出 A 未发布的社区菜图片和 A 的头像');
-- B 的已发布菜 R3 有一张图
reset role;
insert into storage.objects (bucket_id, name) values ('community-media', 'aaaaaaaa-0000-4000-8000-000000000003/pub.jpg');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'community-media' and name like 'aaaaaaaa-0000-4000-8000-000000000003/%'),
  1, '登录用户能读已发布菜的图（存到我的菜谱要复制）');
set local role anon;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'community-media'),
  0, 'anon 不能列公开桶（公开 URL 不需要 select）');

-- 被下架（removed）的菜：作者只能删图，不能写 / 改
reset role;
set local storage.allow_delete_query = 'true';
insert into storage.objects (bucket_id, name) values
  ('community-media', 'aaaaaaaa-0000-4000-8000-000000000002/old1.jpg'),
  ('community-media', 'aaaaaaaa-0000-4000-8000-000000000002/old2.jpg');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'community-media'),
  5, 'A 能列自己的社区菜目录（含 removed）、自己的头像和已发布菜的图');
with u as (update storage.objects set name = 'aaaaaaaa-0000-4000-8000-000000000002/moved.jpg'
           where bucket_id = 'community-media' and name = 'aaaaaaaa-0000-4000-8000-000000000002/old1.jpg' returning 1)
select is(count(*)::int, 0, 'removed 的菜目录作者不能改') from u;
with u as (delete from storage.objects
           where bucket_id = 'community-media' and name = 'aaaaaaaa-0000-4000-8000-000000000002/old1.jpg' returning 1)
select is(count(*)::int, 1, 'removed 的菜目录作者可以删图') from u;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
with u as (delete from storage.objects
           where bucket_id = 'community-media' and name = 'aaaaaaaa-0000-4000-8000-000000000002/old2.jpg' returning 1)
select is(count(*)::int, 0, 'B 不能删 A 的图') from u;

select * from finish();
rollback;
