-- 私信：会话、成员、消息（010_messages.sql）
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;
select plan(151);

-- 测试用户：A、B、C、D
insert into auth.users (id, instance_id, aud, role, email) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.com'),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@example.com');
-- 50 个批量用户，测群人数上限和频率。
insert into auth.users (id, instance_id, aud, role, email)
  select ('eeeeeeee-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u' || g || '@example.com'
    from generate_series(1, 50) g;

-- ------------------------------------------------------------------ schema
select has_table('public', 'conversations', 'conversations 存在');
select has_table('public', 'conversation_members', 'conversation_members 存在');
select has_table('public', 'messages', 'messages 存在');
select has_function('public', 'is_conversation_member', array['uuid'], 'is_conversation_member(uuid) 存在');
select has_function('public', 'open_direct', array['uuid'], 'open_direct(uuid) 存在');
select has_function('public', 'mark_read', array['uuid'], 'mark_read(uuid) 存在');
select has_function('public', 'my_conversations', 'my_conversations() 存在');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'), 'conversations 在 supabase_realtime 里');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members'), 'conversation_members 在 supabase_realtime 里');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'), 'messages 在 supabase_realtime 里');

-- ------------------------------------------------------------- open_direct
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(set_config('test.ab', public.open_direct('22222222-2222-4222-8222-222222222222')::text, true) is not null, 'A 开和 B 的私信得到会话 id');
select throws_ok($$select public.open_direct('11111111-1111-4111-8111-111111111111')$$, 'P0001', 'invalid', '不能和自己开私信');
select throws_ok($$select public.open_direct('99999999-9999-4999-8999-999999999999')$$, 'P0001', 'invalid', '不能和不存在的用户开私信');
select is((select count(*)::int from public.conversation_members where conversation_id = current_setting('test.ab')::uuid), 2, 'A 能看到会话的两个成员');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(public.open_direct('11111111-1111-4111-8111-111111111111'), current_setting('test.ab')::uuid, 'B 开和 A 的私信是同一个会话');
select is((select kind || coalesce(owner_id::text, '-') from public.conversations where id = current_setting('test.ab')::uuid), 'direct-', 'B 能读到会话：direct、无群主');

-- ------------------------------------------------------------ 陌生人限制
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '你好')$$, 'B 没关注 A：A 发第 1 条');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '在吗')$$, 'P0001', 'stranger_limit', 'B 没关注 A 也没回复：第 2 条被拒');
select lives_ok($$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$, 'A 关注 B');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '在吗')$$, 'P0001', 'stranger_limit', 'A 关注 B 不解除 A 的限制');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')$$, 'B 关注 A');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '谢谢关注')$$, 'B 关注 A 后 A 能继续发');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$delete from public.follows where follower_id = '22222222-2222-4222-8222-222222222222' and followee_id = '11111111-1111-4111-8111-111111111111'$$, 'B 取关 A');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '还在吗')$$, 'P0001', 'stranger_limit', 'B 取关后 A 又被限制');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')$$, 'B 再关注 A');
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '22222222-2222-4222-8222-222222222222', '你好呀')$$, 'B 回复 A');
select lives_ok($$delete from public.follows where follower_id = '22222222-2222-4222-8222-222222222222' and followee_id = '11111111-1111-4111-8111-111111111111'$$, 'B 回复后取关 A');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '好的')$$, 'B 回复过：取关后 A 仍能发');

-- --------------------------------------------------------- 成员 / 发送者
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.conversations where id = current_setting('test.ab')::uuid), 0, 'C 读不到 A–B 会话');
select is((select count(*)::int from public.conversation_members where conversation_id = current_setting('test.ab')::uuid), 0, 'C 读不到 A–B 成员');
select is((select count(*)::int from public.messages where conversation_id = current_setting('test.ab')::uuid), 0, 'C 读不到 A–B 消息');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '33333333-3333-4333-8333-333333333333', '插一句')$$, '42501', null, 'C 不能往 A–B 会话发消息');
select throws_ok($$select public.mark_read(current_setting('test.ab')::uuid)$$, 'P0001', 'forbidden', 'C 不能 mark_read 别人的会话');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '22222222-2222-4222-8222-222222222222', '冒充')$$, '42501', null, 'A 不能冒充 B 发消息');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '   ')$$, '23514', null, '空白正文被拒');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', repeat('字', 1001))$$, '23514', null, '1001 字被拒');
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', repeat('字', 1000))$$, '1000 字可以');
select throws_ok($$insert into public.conversations (kind, direct_key) values ('direct', 'x:y')$$, '42501', null, '不能直接建会话');
select throws_ok($$insert into public.conversation_members (conversation_id, user_id) values (current_setting('test.ab')::uuid, '33333333-3333-4333-8333-333333333333')$$, '42501', null, '不能直接加成员');
select throws_ok($$update public.messages set body = '改了' where conversation_id = current_setting('test.ab')::uuid$$, '42501', null, '消息不能改');
select throws_ok($$delete from public.messages where conversation_id = current_setting('test.ab')::uuid$$, '42501', null, '消息不能删');
select throws_ok($$update public.conversation_members set last_read_at = now() where conversation_id = current_setting('test.ab')::uuid$$, '42501', null, '成员行不能直接改');
set local role anon;
select is((select count(*)::int from public.messages), 0, 'anon 读不到消息');
select is((select count(*)::int from public.conversations), 0, 'anon 读不到会话');
select throws_ok($$select public.open_direct('11111111-1111-4111-8111-111111111111')$$, '42501', null, 'anon 不能调 open_direct');

-- ------------------------------------------------------- last_message_at
reset role;
update public.conversations set last_message_at = '2000-01-01' where id = current_setting('test.ab')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '最新一条')$$, 'A 再发一条');
select is((select last_message_at from public.conversations where id = current_setting('test.ab')::uuid), now(), '新消息更新 last_message_at');

-- ------------------------------------------------------ 未读 / 会话列表
reset role;
update public.conversation_members set last_read_at = '2000-01-01' where conversation_id = current_setting('test.ab')::uuid and user_id = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select results_eq($$select kind, unread, peer_id, member_count from public.my_conversations()$$,
  $$values ('direct'::text, 5, '11111111-1111-4111-8111-111111111111'::uuid, 2)$$, 'B 的会话列表：未读 = A 发来的 5 条、对方是 A');
select lives_ok($$select public.mark_read(current_setting('test.ab')::uuid)$$, 'B 标记已读');
select is((select unread from public.my_conversations() where id = current_setting('test.ab')::uuid), 0, 'mark_read 后未读为 0');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(set_config('test.ac', public.open_direct('33333333-3333-4333-8333-333333333333')::text, true) is not null, 'A 开和 C 的私信（不要求关注）');
select results_eq($$select last_body, last_sender_id, unread, peer_id from public.my_conversations() where id = current_setting('test.ac')::uuid$$,
  $$values (null::text, null::uuid, 0, '33333333-3333-4333-8333-333333333333'::uuid)$$, '没有消息时预览为空');
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ac')::uuid, '11111111-1111-4111-8111-111111111111', '嗨 C')$$, 'A 给 C 发一条');
select results_eq($$select last_body, last_sender_id from public.my_conversations() where id = current_setting('test.ac')::uuid$$,
  $$values ('嗨 C'::text, '11111111-1111-4111-8111-111111111111'::uuid)$$, '预览是最新一条消息');
reset role;
update public.conversations set last_message_at = '2000-01-01' where id = current_setting('test.ab')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select results_eq($$select id from public.my_conversations()$$,
  $$values (current_setting('test.ac')::uuid), (current_setting('test.ab')::uuid)$$, '会话按 last_message_at 倒序');

-- -------------------------------------------------------------------- 拉黑
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.blocks (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$, 'A 拉黑 B');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '22222222-2222-4222-8222-222222222222', '为什么')$$, 'P0001', 'recipient_unavailable', '被拉黑的 B 发不出去');
select throws_ok($$select public.open_direct('11111111-1111-4111-8111-111111111111')$$, 'P0001', 'recipient_unavailable', '被拉黑的 B 开不了私信');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '再见')$$, 'P0001', 'recipient_unavailable', '拉黑者 A 也发不出去');
select throws_ok($$select public.open_direct('22222222-2222-4222-8222-222222222222')$$, 'P0001', 'recipient_unavailable', '拉黑者 A 也开不了私信');
select ok((select count(*)::int from public.messages where conversation_id = current_setting('test.ab')::uuid) > 0, 'A 仍能读历史消息');
select lives_ok($$delete from public.blocks where blocked_id = '22222222-2222-4222-8222-222222222222'$$, 'A 解除拉黑');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '22222222-2222-4222-8222-222222222222', '又能说话了')$$, '解除后 B 能发');

-- ================================================================ 群聊
-- 群聊函数
select has_function('public', 'is_mutual', array['uuid', 'uuid'], 'is_mutual(uuid, uuid) 存在');
select ok(not has_function_privilege('authenticated', 'public.is_mutual(uuid, uuid)', 'execute'), 'is_mutual 不授权给客户端');
select has_function('public', 'create_group', array['text', 'uuid[]'], 'create_group(text, uuid[]) 存在');
select has_function('public', 'invite_members', array['uuid', 'uuid[]'], 'invite_members(uuid, uuid[]) 存在');
select has_function('public', 'rename_group', array['uuid', 'text'], 'rename_group(uuid, text) 存在');
select has_function('public', 'remove_member', array['uuid', 'uuid'], 'remove_member(uuid, uuid) 存在');
select has_function('public', 'leave_conversation', array['uuid'], 'leave_conversation(uuid) 存在');

-- A 与 B、C 互关；D 关注 A 但 A 没关注 D；50 个批量用户都和 A 互关。
reset role;
insert into public.follows (follower_id, followee_id) values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'), ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'), ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'), ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111'), ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111')
on conflict do nothing;
insert into public.follows (follower_id, followee_id)
  select '11111111-1111-4111-8111-111111111111', u from unnest(array(select ('eeeeeeee-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 50) g)) u
  union all
  select u, '11111111-1111-4111-8111-111111111111' from unnest(array(select ('eeeeeeee-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 50) g)) u;

-- ---------------------------------------------------------------- 建群
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.create_group('饭友', array['22222222-2222-4222-8222-222222222222']::uuid[])$$, 'P0001', 'invalid', '只选 1 人不能建群');
select throws_ok($$select public.create_group('饭友', array['22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111']::uuid[])$$, 'P0001', 'invalid', '去重、去掉自己后不足 2 人不能建群');
select throws_ok($$select public.create_group('饭友', array['22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444']::uuid[])$$, 'P0001', 'not_mutual', '选了不互关的 D 不能建群');
select throws_ok($$select public.create_group('   ', array['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']::uuid[])$$, 'P0001', 'invalid', '空群名不能建群');
select throws_ok($$select public.create_group(repeat('名', 31), array['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']::uuid[])$$, 'P0001', 'invalid', '31 字群名不能建群');
select ok(set_config('test.g', public.create_group(' 饭友 ', array['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']::uuid[])::text, true) is not null, 'A 选 B、C 建群成功');
select results_eq($$select kind, name, owner_id from public.conversations where id = current_setting('test.g')::uuid$$,
  $$values ('group'::text, '饭友'::text, '11111111-1111-4111-8111-111111111111'::uuid)$$, '群：group、群名去掉首尾空格、owner_id = A');
select results_eq($$select user_id, role from public.conversation_members where conversation_id = current_setting('test.g')::uuid order by user_id$$,
  $$values ('11111111-1111-4111-8111-111111111111'::uuid, 'owner'::text), ('22222222-2222-4222-8222-222222222222'::uuid, 'member'::text), ('33333333-3333-4333-8333-333333333333'::uuid, 'member'::text)$$, 'A 是群主，B、C 是成员');

-- -------------------------------------------------------------- 群消息
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.conversations where id = current_setting('test.g')::uuid), 1, 'B 能读群');
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.g')::uuid, '22222222-2222-4222-8222-222222222222', '大家好')$$, 'B 能在群里发言');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.g')::uuid, '33333333-3333-4333-8333-333333333333', 'C 来了')$$, 'C 能在群里发言');
select is((select count(*)::int from public.messages where conversation_id = current_setting('test.g')::uuid), 2, 'C 能读群消息');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.conversations where id = current_setting('test.g')::uuid), 0, '非成员 D 读不到群');
select is((select count(*)::int from public.messages where conversation_id = current_setting('test.g')::uuid), 0, '非成员 D 读不到群消息');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.g')::uuid, '44444444-4444-4444-8444-444444444444', '插一句')$$, '42501', null, '非成员 D 不能在群里发言');

-- ------------------------------------------------------------ 举报消息
reset role;
select ok(set_config('test.msg_b', (select id::text from public.messages where conversation_id = current_setting('test.g')::uuid and sender_id = '22222222-2222-4222-8222-222222222222'), true) is not null, '取到 B 的群消息 id');
select ok(set_config('test.msg_c', (select id::text from public.messages where conversation_id = current_setting('test.g')::uuid and sender_id = '33333333-3333-4333-8333-333333333333'), true) is not null, '取到 C 的群消息 id');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$insert into public.community_reports (reporter_id, message_id, message_body, reason) values ('33333333-3333-4333-8333-333333333333', current_setting('test.msg_b')::uuid, '伪造的正文', 'unfriendly')$$, 'C 举报 B 的群消息');
select throws_ok($$insert into public.community_reports (reporter_id, message_id, reason) values ('33333333-3333-4333-8333-333333333333', current_setting('test.msg_b')::uuid, 'ad')$$, '23505', null, '重复举报同一条消息 → 唯一冲突');
select throws_ok($$insert into public.community_reports (reporter_id, message_id, reason) values ('33333333-3333-4333-8333-333333333333', current_setting('test.msg_c')::uuid, 'ad')$$, 'P0001', 'forbidden', '不能举报自己的消息');
select throws_ok($$insert into public.community_reports (reporter_id, message_id, comment_id, reason) values ('33333333-3333-4333-8333-333333333333', current_setting('test.msg_b')::uuid, gen_random_uuid(), 'ad')$$, '23514', null, '消息和其他目标不能同时举报');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok($$insert into public.community_reports (reporter_id, message_id, reason) values ('44444444-4444-4444-8444-444444444444', current_setting('test.msg_b')::uuid, 'ad')$$, 'P0001', 'forbidden', '非成员不能举报群消息');
reset role;
select is((select message_body from public.community_reports where message_id = current_setting('test.msg_b')::uuid), '大家好', '举报保存消息原文快照（忽略客户端传值）');

-- ---------------------------------------------------------------- 邀请
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok($$select public.invite_members(current_setting('test.g')::uuid, array['11111111-1111-4111-8111-111111111111']::uuid[])$$, 'P0001', 'forbidden', '非成员不能邀请');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.invite_members(current_setting('test.ab')::uuid, array['33333333-3333-4333-8333-333333333333']::uuid[])$$, 'P0001', 'forbidden', '私信会话不能邀请');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$select public.invite_members(current_setting('test.g')::uuid, array['44444444-4444-4444-8444-444444444444']::uuid[])$$, 'P0001', 'not_mutual', 'B 与 D 不互关：邀请被拒');
reset role;
insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444'), ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$select public.invite_members(current_setting('test.g')::uuid, array['44444444-4444-4444-8444-444444444444']::uuid[])$$, 'B 与 D 互关后：普通成员 B 能邀请 D');
select lives_ok($$select public.invite_members(current_setting('test.g')::uuid, array['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']::uuid[])$$, '邀请已在群里的人不报错');
select results_eq($$select user_id, role from public.conversation_members where conversation_id = current_setting('test.g')::uuid order by user_id$$,
  $$values ('11111111-1111-4111-8111-111111111111'::uuid, 'owner'::text), ('22222222-2222-4222-8222-222222222222'::uuid, 'member'::text), ('33333333-3333-4333-8333-333333333333'::uuid, 'member'::text), ('44444444-4444-4444-8444-444444444444'::uuid, 'member'::text)$$, '邀请后 4 人，不重复');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.g')::uuid, '44444444-4444-4444-8444-444444444444', 'D 报到')$$, '被邀请的 D 能在群里发言');

-- -------------------------------------------------------------- 改群名
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$select public.rename_group(current_setting('test.g')::uuid, '新名字')$$, 'P0001', 'forbidden', '非群主 B 不能改群名');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.rename_group(current_setting('test.g')::uuid, '')$$, 'P0001', 'invalid', '空群名被拒');
select throws_ok($$select public.rename_group(current_setting('test.g')::uuid, repeat('名', 31))$$, 'P0001', 'invalid', '31 字群名被拒');
select throws_ok($$select public.rename_group(current_setting('test.ab')::uuid, '私信')$$, 'P0001', 'forbidden', '私信不能改名');
select lives_ok($$select public.rename_group(current_setting('test.g')::uuid, ' 周末饭局 ')$$, '群主 A 改群名');
select is((select name from public.conversations where id = current_setting('test.g')::uuid), '周末饭局', '群名已改');

-- ---------------------------------------------------------------- 移除
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$select public.remove_member(current_setting('test.g')::uuid, '33333333-3333-4333-8333-333333333333')$$, 'P0001', 'forbidden', '非群主 B 不能移除成员');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.remove_member(current_setting('test.g')::uuid, '11111111-1111-4111-8111-111111111111')$$, 'P0001', 'invalid', '群主不能移除自己');
select lives_ok($$select public.remove_member(current_setting('test.g')::uuid, '33333333-3333-4333-8333-333333333333')$$, '群主 A 移除 C');
select lives_ok($$select public.remove_member(current_setting('test.g')::uuid, '44444444-4444-4444-8444-444444444444')$$, '群主 A 移除 D');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.conversations where id = current_setting('test.g')::uuid), 0, '被移除的 C 读不到群');
select is((select count(*)::int from public.messages where conversation_id = current_setting('test.g')::uuid), 0, '被移除的 C 读不到群消息');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.g')::uuid, '33333333-3333-4333-8333-333333333333', '我还在吗')$$, '42501', null, '被移除的 C 不能发言');

-- -------------------------------------------------- 拉黑后不能互相邀请
-- D 的群（D 群主、B 成员），A 不在里面；g 里也没有 D。
reset role;
insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444');
insert into public.conversations (id, kind, name, owner_id) values ('dddddddd-0000-4000-8000-000000000001', 'group', 'D 的群', '44444444-4444-4444-8444-444444444444');
insert into public.conversation_members (conversation_id, user_id, role) values ('dddddddd-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'owner'), ('dddddddd-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'member');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$insert into public.blocks (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444')$$, 'A 拉黑 D');
-- 拉黑会删掉互关；绕过触发器补回互关，确认 is_mutual 本身也检查拉黑。
reset role;
alter table public.follows disable trigger follows_check_block;
insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444'), ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111');
alter table public.follows enable trigger follows_check_block;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.invite_members(current_setting('test.g')::uuid, array['44444444-4444-4444-8444-444444444444']::uuid[])$$, 'P0001', 'not_mutual', 'A 拉黑 D 后 A 不能邀请 D');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok($$select public.invite_members('dddddddd-0000-4000-8000-000000000001', array['11111111-1111-4111-8111-111111111111']::uuid[])$$, 'P0001', 'not_mutual', '被拉黑的 D 也不能邀请 A');

-- ---------------------------------------------------------------- 退群
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.leave_conversation(current_setting('test.ab')::uuid)$$, 'P0001', 'invalid', '私信不能退');
select throws_ok($$select public.leave_conversation('dddddddd-0000-4000-8000-000000000001')$$, 'P0001', 'forbidden', '不在群里不能退');
select lives_ok($$select public.leave_conversation(current_setting('test.g')::uuid)$$, '群主 A 退群');
select is((select count(*)::int from public.conversations where id = current_setting('test.g')::uuid), 0, '退群后 A 读不到群');
reset role;
select is((select owner_id from public.conversations where id = current_setting('test.g')::uuid), '22222222-2222-4222-8222-222222222222'::uuid, '群主转给最早入群的 B，owner_id 同步');
select results_eq($$select user_id, role from public.conversation_members where conversation_id = current_setting('test.g')::uuid$$,
  $$values ('22222222-2222-4222-8222-222222222222'::uuid, 'owner'::text)$$, 'B 的角色变为 owner');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$select public.leave_conversation(current_setting('test.g')::uuid)$$, '最后一人 B 退群');
reset role;
select is((select count(*)::int from public.conversations where id = current_setting('test.g')::uuid), 0, '最后一人退出后会话被删除');
select is((select count(*)::int from public.messages where conversation_id = current_setting('test.g')::uuid), 0, '会话的消息随之删除');

-- ------------------------------------------------ 群里的拉黑：未读和预览
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select ok(set_config('test.g2', public.create_group('拉黑测试', array['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']::uuid[])::text, true) is not null, 'A、B、C 再建一个群');
select lives_ok($$insert into public.blocks (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$, 'A 拉黑 B');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.g2')::uuid, '22222222-2222-4222-8222-222222222222', 'B 第一条')$$, '被 A 拉黑的 B 仍能在群里发言');
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.g2')::uuid, '22222222-2222-4222-8222-222222222222', 'B 第二条')$$, 'B 再发一条');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.g2')::uuid, '33333333-3333-4333-8333-333333333333', 'C 说话')$$, 'C 在群里发言');
reset role;
update public.messages set created_at = now() - interval '1 minute' where conversation_id = current_setting('test.g2')::uuid and sender_id = '33333333-3333-4333-8333-333333333333';
update public.conversation_members set last_read_at = '2000-01-01' where conversation_id = current_setting('test.g2')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select results_eq($$select unread, last_body, last_sender_id from public.my_conversations() where id = current_setting('test.g2')::uuid$$,
  $$values (1, 'C 说话'::text, '33333333-3333-4333-8333-333333333333'::uuid)$$, '群里 A 的未读和预览不计拉黑的 B');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select results_eq($$select unread, last_sender_id from public.my_conversations() where id = current_setting('test.g2')::uuid$$,
  $$values (2, '22222222-2222-4222-8222-222222222222'::uuid)$$, '同一群里 C 照常计入 B 的消息');
-- 私信不排除：绕过触发器让 B 在 A–B 私信里补一条最新消息。
reset role;
alter table public.messages disable trigger messages_before_insert;
insert into public.messages (conversation_id, sender_id, body, created_at) values (current_setting('test.ab')::uuid, '22222222-2222-4222-8222-222222222222', '拉黑后补一条', now() + interval '1 second');
alter table public.messages enable trigger messages_before_insert;
update public.conversation_members set last_read_at = '2000-01-01' where conversation_id = current_setting('test.ab')::uuid and user_id = '11111111-1111-4111-8111-111111111111';
select ok(set_config('test.ab_from_b', (select count(*)::text from public.messages where conversation_id = current_setting('test.ab')::uuid and sender_id = '22222222-2222-4222-8222-222222222222'), true) is not null, '数出 B 在私信里的消息数');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select results_eq($$select unread, last_body from public.my_conversations() where id = current_setting('test.ab')::uuid$$,
  $$values (current_setting('test.ab_from_b')::int, '拉黑后补一条'::text)$$, '私信里拉黑的 B 的消息照常计入未读和预览');

-- ------------------------------------------------------------ 人数上限
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.create_group('大群', array(select ('eeeeeeee-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 50) g))$$, 'P0001', 'group_full', '建群 51 人被拒');
select ok(set_config('test.big', public.create_group('大群', array(select ('eeeeeeee-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 49) g))::text, true) is not null, '建群 50 人可以');
select is((select count(*)::int from public.conversation_members where conversation_id = current_setting('test.big')::uuid), 50, '大群 50 人');
select throws_ok($$select public.invite_members(current_setting('test.big')::uuid, array['eeeeeeee-0000-4000-8000-000000000050']::uuid[])$$, 'P0001', 'group_full', '第 51 人邀请被拒');
reset role;
select throws_ok($$insert into public.conversation_members (conversation_id, user_id) values (current_setting('test.big')::uuid, 'eeeeeeee-0000-4000-8000-000000000050')$$, 'P0001', 'group_full', '触发器兜底：直接插第 51 人被拒');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok($$select public.remove_member(current_setting('test.big')::uuid, 'eeeeeeee-0000-4000-8000-000000000048'), public.remove_member(current_setting('test.big')::uuid, 'eeeeeeee-0000-4000-8000-000000000049')$$, '移除 2 人后 48 人');
select throws_ok($$select public.invite_members(current_setting('test.big')::uuid, array['eeeeeeee-0000-4000-8000-000000000048', 'eeeeeeee-0000-4000-8000-000000000049', 'eeeeeeee-0000-4000-8000-000000000050']::uuid[])$$, 'P0001', 'group_full', '一次邀请 3 人会超过 50：被拒');
select is((select count(*)::int from public.conversation_members where conversation_id = current_setting('test.big')::uuid), 48, '超限时整批不加');
select lives_ok($$select public.invite_members(current_setting('test.big')::uuid, array['eeeeeeee-0000-4000-8000-000000000049', 'eeeeeeee-0000-4000-8000-000000000050']::uuid[])$$, '邀请 2 人到 50 人可以');
select is((select count(*)::int from public.conversation_members where conversation_id = current_setting('test.big')::uuid), 50, '大群又是 50 人');

-- -------------------------------------------------------------------- 频率
-- 新发送者 U1 此前没发过消息：superuser 插 29 条当前时间的 + 30 条 2 分钟前的（不计入）。
reset role;
alter table public.messages disable trigger messages_before_insert;
insert into public.messages (conversation_id, sender_id, body, created_at)
  select current_setting('test.big')::uuid, 'eeeeeeee-0000-4000-8000-000000000001', '刷屏 ' || g, now() from generate_series(1, 29) g;
insert into public.messages (conversation_id, sender_id, body, created_at)
  select current_setting('test.big')::uuid, 'eeeeeeee-0000-4000-8000-000000000001', '早先 ' || g, now() - interval '2 minutes' from generate_series(1, 30) g;
alter table public.messages enable trigger messages_before_insert;
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.big')::uuid, 'eeeeeeee-0000-4000-8000-000000000001', '第 30 条')$$, '1 分钟内第 30 条可以（2 分钟前的不计）');
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.big')::uuid, 'eeeeeeee-0000-4000-8000-000000000001', '第 31 条')$$, 'P0001', 'rate_limited', '1 分钟内第 31 条被限流');

-- ------------------------------------------------------------ 账号删除
-- D 的群：D 群主、B 成员；再加一个更早入群的 C。删除 D 的账号 → 群主转给最早入群的 C。
reset role;
insert into public.conversation_members (conversation_id, user_id, role, joined_at) values ('dddddddd-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'member', now() - interval '1 hour');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select lives_ok($$insert into public.messages (conversation_id, sender_id, body) values ('dddddddd-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'D 的留言')$$, 'D 在自己的群里发言');
reset role;
select lives_ok($$delete from auth.users where id = '44444444-4444-4444-8444-444444444444'$$, '删除群主 D 的账号');
select is((select owner_id from public.conversations where id = 'dddddddd-0000-4000-8000-000000000001'), '33333333-3333-4333-8333-333333333333'::uuid, '账号删除后群主转给最早入群的 C');
select results_eq($$select user_id, role from public.conversation_members where conversation_id = 'dddddddd-0000-4000-8000-000000000001' order by user_id$$,
  $$values ('22222222-2222-4222-8222-222222222222'::uuid, 'member'::text), ('33333333-3333-4333-8333-333333333333'::uuid, 'owner'::text)$$, 'D 的成员行删除，C 成为 owner');
select results_eq($$select body, sender_id from public.messages where conversation_id = 'dddddddd-0000-4000-8000-000000000001'$$,
  $$values ('D 的留言'::text, null::uuid)$$, 'D 的消息保留，sender_id 为 null');

select * from finish();
rollback;
