-- 关注 / 拉黑 / 举报用户（009_social_follow.sql）
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- 测试用户：A、B、C
insert into auth.users (id, instance_id, aud, role, email) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.com');

-- ------------------------------------------------------------------ schema
select has_table('public', 'follows', 'follows 存在');
select has_table('public', 'blocks', 'blocks 存在');
select has_function('public', 'social_stats', array['uuid'], 'social_stats(uuid) 存在');

-- -------------------------------------------------------------------- 关注
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')$$, 'B 关注 A');
select throws_ok($$insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')$$, '23505', null, '重复关注 → 主键冲突');
select throws_ok($$insert into public.follows (follower_id, followee_id) values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111')$$, '42501', null, '不能替别人关注');
select throws_ok($$insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222')$$, '23514', null, '不能关注自己');
select throws_ok($$update public.follows set followee_id = '33333333-3333-4333-8333-333333333333' where follower_id = '22222222-2222-4222-8222-222222222222'$$, '42501', null, '关注关系不能改（无 update 权限）');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$insert into public.follows (follower_id, followee_id) values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111')$$, 'C 关注 A');
select is((select count(*)::int from public.follows where followee_id = '11111111-1111-4111-8111-111111111111'), 2, 'C 能读到 A 的全部粉丝');
select is((select count(*)::int from public.follows where follower_id = '22222222-2222-4222-8222-222222222222'), 1, 'C 能读到 B 的关注');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$, 'A 回关 B');
select results_eq($$select following_count, follower_count, i_follow, follows_me from public.social_stats('22222222-2222-4222-8222-222222222222')$$,
  $$values (1, 1, true, true)$$, 'A 看 B：关注 1、粉丝 1、互相关注');
select results_eq($$select following_count, follower_count, i_follow, follows_me from public.social_stats('11111111-1111-4111-8111-111111111111')$$,
  $$values (1, 2, false, false)$$, 'A 看自己：关注 1、粉丝 2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select results_eq($$select i_follow, follows_me from public.social_stats('22222222-2222-4222-8222-222222222222')$$, $$values (false, false)$$, 'C 看 B：没关系');
delete from public.follows where follower_id = '22222222-2222-4222-8222-222222222222';
select is((select count(*)::int from public.follows where follower_id = '22222222-2222-4222-8222-222222222222'), 1, 'C 删不掉 B 的关注');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$delete from public.follows where follower_id = '33333333-3333-4333-8333-333333333333' and followee_id = '11111111-1111-4111-8111-111111111111'$$, 'C 取关 A');
select is((select count(*)::int from public.follows where follower_id = '33333333-3333-4333-8333-333333333333'), 0, '取关后没有记录');
set local role anon;
select is((select count(*)::int from public.follows), 0, 'anon 读不到关注');
select throws_ok($$select * from public.social_stats('11111111-1111-4111-8111-111111111111')$$, '42501', null, 'anon 不能调 social_stats');

-- -------------------------------------------------------------------- 拉黑
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.blocks (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$, 'A 拉黑 B');
select is((select count(*)::int from public.follows where (follower_id = '11111111-1111-4111-8111-111111111111' and followee_id = '22222222-2222-4222-8222-222222222222') or (follower_id = '22222222-2222-4222-8222-222222222222' and followee_id = '11111111-1111-4111-8111-111111111111')), 0, '拉黑后双方关注都被删');
select throws_ok($$insert into public.blocks (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')$$, '23514', null, '不能拉黑自己');
select throws_ok($$insert into public.blocks (blocker_id, blocked_id) values ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222')$$, '42501', null, '不能替别人拉黑');
select throws_ok($$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$, 'P0001', 'follow_blocked', 'A 拉黑 B 后 A 不能关注 B');
select is((select count(*)::int from public.blocks), 1, 'A 能读到自己的拉黑记录');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')$$, 'P0001', 'follow_blocked', '被拉黑的 B 不能关注 A');
select is((select count(*)::int from public.blocks), 0, 'B 读不到 A 的拉黑记录');
delete from public.blocks;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.blocks), 1, 'B 删不掉 A 的拉黑');
select lives_ok($$delete from public.blocks where blocked_id = '22222222-2222-4222-8222-222222222222'$$, 'A 解除拉黑');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')$$, '解除后 B 可以再关注 A');
set local role anon;
select is((select count(*)::int from public.blocks), 0, 'anon 读不到拉黑');

-- -------------------------------------------------------------- 举报用户
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$insert into public.community_reports (reporter_id, reported_user_id, reason) values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'unfriendly')$$, 'C 举报 A');
select throws_ok($$insert into public.community_reports (reporter_id, reported_user_id, reason) values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'ad')$$, '23505', null, '重复举报同一用户 → 唯一冲突');
select throws_ok($$insert into public.community_reports (reporter_id, reason) values ('33333333-3333-4333-8333-333333333333', 'ad')$$, '23514', null, '没有举报目标被拒');
select throws_ok($$insert into public.community_reports (reporter_id, reported_user_id, reason) values ('33333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'ad')$$, '23514', null, '不能举报自己');

select * from finish();
rollback;
