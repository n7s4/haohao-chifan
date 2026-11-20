-- 私信：会话、成员、消息（010_messages.sql）
begin;
set local client_min_messages = warning;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- 测试用户：A、B、C
insert into auth.users (id, instance_id, aud, role, email) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.com');

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

-- -------------------------------------------------------------------- 频率
reset role;
alter table public.messages disable trigger messages_before_insert;
insert into public.messages (conversation_id, sender_id, body, created_at)
  select current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '刷屏 ' || g, now() from generate_series(1, 30) g;
alter table public.messages enable trigger messages_before_insert;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$insert into public.messages (conversation_id, sender_id, body) values (current_setting('test.ab')::uuid, '11111111-1111-4111-8111-111111111111', '第 31 条')$$, 'P0001', 'rate_limited', '1 分钟内第 31 条被限流');

select * from finish();
rollback;
