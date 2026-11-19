-- 社区点赞 / 评论 / 举报（007_community.sql 后半）
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- 测试用户：A（作者）、B、C
insert into auth.users (id, instance_id, aud, role, email) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.com');

-- A 的菜：R1 published、R2 withdrawn、R3 published
insert into public.community_recipes (id, author_id, source_recipe_id, name, status) values
  ('aaaaaaaa-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'r1', '番茄炒蛋', 'published'),
  ('aaaaaaaa-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'r2', '已撤回', 'withdrawn'),
  ('aaaaaaaa-0000-4000-8000-000000000013', '11111111-1111-4111-8111-111111111111', 'r3', '另一道菜', 'published');

-- ------------------------------------------------------------------ schema
select has_table('public', 'community_likes', 'community_likes 存在');
select has_table('public', 'community_comments', 'community_comments 存在');
select has_table('public', 'community_reports', 'community_reports 存在');

-- -------------------------------------------------------------------- 点赞
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$insert into public.community_likes (user_id, community_recipe_id) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000011')$$, 'B 给 A 的菜点赞');
select throws_ok($$insert into public.community_likes (user_id, community_recipe_id) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000011')$$,
  '23505', null, '重复点赞 → 主键冲突');
select is((select like_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000011'), 1, '点赞两次 like_count = 1');
select is((select count(*)::int from public.community_likes where community_recipe_id = 'aaaaaaaa-0000-4000-8000-000000000011'), 1, 'B 能读自己的赞');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.community_likes), 0, 'C 看不到别人点了什么赞');
set local role anon;
select is((select count(*)::int from public.community_likes), 0, 'anon 看不到点赞记录');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$insert into public.community_likes (user_id, community_recipe_id) values ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000013')$$,
  '42501', null, '不能替别人点赞');
delete from public.community_likes where user_id = '22222222-2222-4222-8222-222222222222' and community_recipe_id = 'aaaaaaaa-0000-4000-8000-000000000011';
delete from public.community_likes where user_id = '22222222-2222-4222-8222-222222222222' and community_recipe_id = 'aaaaaaaa-0000-4000-8000-000000000011';
select is((select like_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000011'), 0, '取消两次 like_count = 0');
reset role;
update public.community_recipes set like_count = 0 where id = 'aaaaaaaa-0000-4000-8000-000000000013';
insert into public.community_likes (user_id, community_recipe_id) values ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000013');
update public.community_recipes set like_count = 0 where id = 'aaaaaaaa-0000-4000-8000-000000000013';
delete from public.community_likes where user_id = '33333333-3333-4333-8333-333333333333' and community_recipe_id = 'aaaaaaaa-0000-4000-8000-000000000013';
select is((select like_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000013'), 0, 'like_count 不低于 0');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$insert into public.community_likes (user_id, community_recipe_id) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000012')$$,
  '42501', null, '给 withdrawn 的菜点赞 → RLS 拒绝');

-- -------------------------------------------------------------------- 评论
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000012', '22222222-2222-4222-8222-222222222222', '好吃')$$,
  '42501', null, '给 withdrawn 的菜评论 → RLS 拒绝');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '33333333-3333-4333-8333-333333333333', '冒名')$$,
  '42501', null, '不能以别人的名义评论');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', '  ')$$,
  '23514', null, '空白评论被拒');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', repeat('a', 501))$$,
  '23514', null, '501 字评论被拒');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', E'\n\t')$$,
  '23514', null, '只有换行 / 制表符的评论被拒');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', E'\u3000\u3000')$$,
  '23514', null, '只有全角空格的评论被拒');
select lives_ok($$insert into public.community_comments (id, community_recipe_id, user_id, body) values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', repeat('🍜', 500))$$,
  '500 个 emoji（按码点计）可以');
select lives_ok($$insert into public.community_comments (id, community_recipe_id, user_id, parent_id, body) values ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', 'cccccccc-0000-4000-8000-000000000001', '回复')$$,
  '一层回复可以');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, parent_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', 'cccccccc-0000-4000-8000-000000000002', '回复的回复')$$,
  '23514', null, '回复的回复 → 报错');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, parent_id, body) values ('aaaaaaaa-0000-4000-8000-000000000013', '22222222-2222-4222-8222-222222222222', 'cccccccc-0000-4000-8000-000000000001', '跨菜回复')$$,
  '23514', null, 'parent 属于另一道菜 → 报错');
select is((select comment_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000011'), 2, '评论后 comment_count = 2');

-- 「回复 @某人」（008）
select has_column('public', 'community_comments', 'reply_to_user_id', 'community_comments.reply_to_user_id 存在');
select lives_ok($$insert into public.community_comments (id, community_recipe_id, user_id, parent_id, reply_to_user_id, body) values ('cccccccc-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', 'cccccccc-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '回复楼里的人')$$,
  '回复同一楼里发过言的人可以');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, parent_id, reply_to_user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', 'cccccccc-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', '回复不在楼里的人')$$,
  '23514', null, '回复对象不在这一楼 → 报错');
select throws_ok($$insert into public.community_comments (community_recipe_id, user_id, reply_to_user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '没有 parent')$$,
  '23514', null, '顶层评论不能带回复对象');
select throws_ok($$update public.community_comments set reply_to_user_id = null where id = 'cccccccc-0000-4000-8000-000000000009'$$,
  '23514', null, '客户端不能改回复对象');
reset role;
delete from public.community_comments where id = 'cccccccc-0000-4000-8000-000000000009';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

insert into public.community_comments (id, community_recipe_id, user_id, body) values ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', '要被删的');
insert into public.community_comments (id, community_recipe_id, user_id, body) values ('cccccccc-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', 'A 来删');
select is((select comment_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000011'), 4, '再评两条 comment_count = 4');
insert into public.community_comments (id, community_recipe_id, user_id, body, created_at) values ('cccccccc-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', '穿越', '2999-01-01');
select is((select created_at from public.community_comments where id = 'cccccccc-0000-4000-8000-000000000006'), now(), '客户端不能伪造评论 created_at');
update public.community_comments set deleted = true where id = 'cccccccc-0000-4000-8000-000000000006';

-- 删除（软删）
update public.community_comments set deleted = true where id = 'cccccccc-0000-4000-8000-000000000003';
select is((select body from public.community_comments where id = 'cccccccc-0000-4000-8000-000000000003'), '', 'B 删自己的评论 → body 清空');
select is((select comment_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000011'), 3, '删除后 comment_count 减 1');
select throws_ok($$update public.community_comments set body = '改正文' where id = 'cccccccc-0000-4000-8000-000000000004'$$,
  '23514', null, '客户端不能改正文');
select throws_ok($$update public.community_comments set deleted = false where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  '23514', null, '不能撤销删除');
select throws_ok($$update public.community_comments set hidden = true where id = 'cccccccc-0000-4000-8000-000000000004'$$,
  '23514', null, '客户端不能设 hidden');

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
with u as (update public.community_comments set deleted = true where id = 'cccccccc-0000-4000-8000-000000000004' returning 1)
select is(count(*)::int, 0, 'C 不能删 B 的评论（0 行）') from u;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
with u as (update public.community_comments set deleted = true where id = 'cccccccc-0000-4000-8000-000000000004' returning 1)
select is(count(*)::int, 1, 'A（菜的作者）能删 B 的评论') from u;
select is((select comment_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000011'), 2, '作者删除后 comment_count 再减 1');

-- 管理员隐藏 → 它和它的回复都不可见
set local role service_role;
update public.community_comments set hidden = true where id = 'cccccccc-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*)::int from public.community_comments where id in ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002')), 0, 'hidden 评论及其回复 anon 不可见');
select is((select count(*)::int from public.community_comments where id = 'cccccccc-0000-4000-8000-000000000003'), 1, '已删除评论仍可见（显示「该评论已删除」）');
select is((select body from public.community_comments where id = 'cccccccc-0000-4000-8000-000000000003'), '', 'anon 读不到已删评论原文');

-- 注销账号（硬删除）→ 未删除的评论计数减掉
reset role;
insert into auth.users (id, instance_id, aud, role, email) values
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@example.com');
insert into public.community_comments (community_recipe_id, user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000011', '44444444-4444-4444-8444-444444444444', 'D 的评论');
select is((select comment_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000011'), 3, 'D 评论后 comment_count = 3');
delete from auth.users where id = '44444444-4444-4444-8444-444444444444';
select is((select comment_count from public.community_recipes where id = 'aaaaaaaa-0000-4000-8000-000000000011'), 2, '注销 D 后 comment_count 回到 2');

-- 撤回菜后评论不可见
reset role;
insert into public.community_comments (id, community_recipe_id, user_id, body) values ('cccccccc-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000013', '22222222-2222-4222-8222-222222222222', 'R3 的评论');
update public.community_recipes set status = 'withdrawn' where id = 'aaaaaaaa-0000-4000-8000-000000000013';
set local role anon;
select is((select count(*)::int from public.community_comments where id = 'cccccccc-0000-4000-8000-000000000005'), 0, '菜撤回后评论不可见');

-- -------------------------------------------------------------------- 举报
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$insert into public.community_reports (reporter_id, community_recipe_id, reason) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000011', 'ad')$$, 'B 举报菜');
select throws_ok($$insert into public.community_reports (reporter_id, community_recipe_id, reason) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000011', 'other')$$,
  '23505', null, '重复举报同一目标 → 报错');
select lives_ok($$insert into public.community_reports (reporter_id, comment_id, reason) values ('22222222-2222-4222-8222-222222222222', 'cccccccc-0000-4000-8000-000000000004', 'unfriendly')$$, 'B 举报评论');
select throws_ok($$insert into public.community_reports (reporter_id, community_recipe_id, comment_id, reason) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000013', 'cccccccc-0000-4000-8000-000000000005', 'ad')$$,
  '23514', null, '目标必须恰好一个');
select throws_ok($$insert into public.community_reports (reporter_id, community_recipe_id, reason, resolved) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000013', 'ad', true)$$,
  '42501', null, '客户端不能插入 resolved = true 的举报');
select is((select count(*)::int from public.community_reports), 0, 'B select 举报表 → 0 行');

select * from finish();
rollback;
