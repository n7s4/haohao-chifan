/**
 * 社区 API 集成测试：连本地 Supabase 栈，只在 COMMUNITY_IT=1 时运行。
 *
 *   eval "$(supabase status -o env)"
 *   COMMUNITY_IT=1 SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" \
 *     SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
 *     deno test --sloppy-imports --allow-net --allow-env src/lib/community/api_test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Recipe } from "../../data/recipes.ts";
import { fromSnapshot } from "./logic.ts";
import {
  addComment,
  listComments,
  cleanupWithdrawnMedia,
  copyToPrivate,
  deleteComment,
  findMyPublication,
  getCommunityRecipe,
  ensurePublicProfile,
  getCommunityRecipes,
  getProfiles,
  listCommunity,
  myLikes,
  publishRecipe,
  report,
  setLike,
  syncPublicAvatar,
  withdrawRecipe,
} from "./api.ts";
import {
  block,
  follow,
  getSocialStats,
  listFollows,
  listUserRecipes,
  myBlocks,
  relationsTo,
  unblock,
  unfollow,
} from "./social.ts";
import {
  createGroup,
  getConversation,
  inviteMembers,
  leaveConversation,
  listConversations,
  listMembers,
  listMessages,
  listMutuals,
  markRead,
  openDirect,
  removeMember,
  renameGroup,
  sendMessage,
  subscribeMessages,
} from "./messages.ts";

// npm run test:unit 不带 --allow-env：没有权限就当作未开启，不报错。
const canReadEnv = Deno.permissions.querySync({ name: "env" }).state === "granted";
const env = (k: string) => (canReadEnv ? Deno.env.get(k) : undefined);
const enabled = env("COMMUNITY_IT") === "1";
const url = env("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const anonKey = env("SUPABASE_ANON_KEY") ?? "";
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// 最小 JPEG 字节（SOI … EOI）；桶只按 contentType 校验，不解码。
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

async function makeUser(admin: SupabaseClient, tag: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `it-${tag}-${crypto.randomUUID()}@example.test`;
  const password = "pw-" + crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

async function status(u: string): Promise<number> {
  const res = await fetch(u);
  await res.body?.cancel();
  return res.status;
}

Deno.test({
  name: "community api: publish / like / report / withdraw",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(anonKey && serviceKey, "SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 未设置");
    const admin = createClient(url, serviceKey, noSession);
    const a = await makeUser(admin, "a");
    const b = await makeUser(admin, "b");
    const privatePaths: string[] = [];
    try {
      // A 上传一张私有图
      const recipeId = crypto.randomUUID();
      const imageId = crypto.randomUUID();
      const privatePath = `${a.id}/${recipeId}/${imageId}.jpg`;
      privatePaths.push(privatePath);
      const up = await a.client.storage.from("recipe-media").upload(privatePath, JPEG, { contentType: "image/jpeg" });
      assertEquals(up.error, null);

      const recipe: Recipe = {
        id: recipeId,
        name: "集成测试番茄蛋",
        subtitle: "",
        description: "",
        minutes: 10,
        difficulty: "简单",
        calories: 200,
        tags: [],
        cover: { id: imageId, path: privatePath, width: 1, height: 1 },
        ingredients: [{ name: "番茄", qty: 2, unit: "个" }],
        steps: [{ text: "炒" }],
        custom: true,
      };

      // 有未上传的图 → invalid
      const notUploaded = await publishRecipe(a.client, a.id, { ...recipe, cover: { id: "x" } });
      assertEquals(notUploaded, { ok: false, reason: "invalid" });

      const pub = await publishRecipe(a.client, a.id, recipe);
      assert(pub.ok, JSON.stringify(pub));
      const cr = pub.value;
      assertEquals(cr.status, "published");
      assertEquals(cr.authorId, a.id);
      assertEquals(cr.recipe.cover?.path, `${cr.id}/${imageId}.jpg`);

      // B 能从公开桶拿到图
      const publicUrl = b.client.storage.from("community-media").getPublicUrl(cr.recipe.cover!.path!).data.publicUrl;
      assertEquals(await status(publicUrl), 200);

      // 重新发布复用同一个 id；加一张步骤图：封面不变，URL 一直 200
      const stepImageId = crypto.randomUUID();
      const stepPath = `${a.id}/${recipeId}/${stepImageId}.jpg`;
      privatePaths.push(stepPath);
      assertEquals((await a.client.storage.from("recipe-media").upload(stepPath, JPEG, { contentType: "image/jpeg" })).error, null);
      const v2: Recipe = { ...recipe, name: "集成测试番茄蛋 v2", steps: [{ text: "炒", images: [{ id: stepImageId, path: stepPath }] }] };
      const again = await publishRecipe(a.client, a.id, v2);
      assert(again.ok, JSON.stringify(again));
      assertEquals(again.value.id, cr.id);
      assertEquals(again.value.recipe.name, "集成测试番茄蛋 v2");
      assertEquals(await status(publicUrl), 200);
      const stepUrl = b.client.storage.from("community-media").getPublicUrl(`${cr.id}/${stepImageId}.jpg`).data.publicUrl;
      assertEquals(await status(stepUrl), 200);
      // 再发布一次去掉步骤图：多余的图被删，封面仍 200
      const v3 = await publishRecipe(a.client, a.id, { ...v2, steps: [{ text: "炒" }] });
      assert(v3.ok, JSON.stringify(v3));
      assertEquals(await status(publicUrl), 200);
      const stepGone = await status(stepUrl);
      assert(stepGone === 400 || stepGone === 404, `expected 400/404, got ${stepGone}`);
      const mine = await findMyPublication(a.client, a.id, recipeId);
      assert(mine.ok && mine.value?.id === cr.id);

      // B 把 A 的菜存到自己的菜谱：公开桶 → B 的私有桶，B 能用签名 URL 读到
      const forB = fromSnapshot(v3.value, b.id, "custom-it-" + crypto.randomUUID(), "小A");
      assertEquals(forB.copies.length, 1);
      privatePaths.push(...forB.copies.map((c) => c.to));
      assertEquals(await copyToPrivate(b.client, forB.copies), { ok: true, value: undefined });
      const signed = await b.client.storage.from("recipe-media").createSignedUrl(forB.input.cover!.path!, 60);
      assertEquals(signed.error, null);
      assertEquals(await status(signed.data!.signedUrl), 200);
      // A 读不到 B 的私有图
      const peek = await a.client.storage.from("recipe-media").createSignedUrl(forB.input.cover!.path!, 60);
      assert(peek.error !== null || (await status(peek.data!.signedUrl)) !== 200);
      // 源图不存在 → 失败，且已复制的会被清掉
      const bad = [
        { from: `${cr.id}/${imageId}.jpg`, to: `${b.id}/bad-${crypto.randomUUID()}/ok.jpg` },
        { from: `${cr.id}/missing.jpg`, to: `${b.id}/bad-${crypto.randomUUID()}/missing.jpg` },
      ];
      privatePaths.push(...bad.map((c) => c.to));
      const failed = await copyToPrivate(b.client, bad);
      assertEquals(failed.ok, false);
      const leftover = await b.client.storage.from("recipe-media").createSignedUrl(bad[0].to, 60);
      assert(leftover.error !== null, "失败时已复制的私有图应被清掉");

      // B 连点两次赞 → 都 ok，计数 1
      assertEquals(await setLike(b.client, b.id, cr.id, true), { ok: true, value: undefined });
      assertEquals(await setLike(b.client, b.id, cr.id, true), { ok: true, value: undefined });
      const seen = await getCommunityRecipe(b.client, cr.id);
      assert(seen.ok);
      assertEquals(seen.value.likeCount, 1);
      const likes = await myLikes(b.client, b.id, [cr.id]);
      assert(likes.ok && likes.value.has(cr.id));
      const listed = await getCommunityRecipes(b.client, [cr.id, crypto.randomUUID()]);
      assert(listed.ok);
      assertEquals(listed.value.map((x) => x.id), [cr.id]);

      const hot = await listCommunity(b.client, { sort: "hot", offset: 0, limit: 50 });
      assert(hot.ok);
      assert(hot.value.some((x) => x.id === cr.id));
      const counts = hot.value.map((x) => x.likeCount);
      assertEquals(counts, [...counts].sort((p, q) => q - p));

      // 公开资料与头像
      assertEquals(await ensurePublicProfile(a.client, a.id, "  小A  "), { ok: true, value: undefined });
      assertEquals(await ensurePublicProfile(a.client, a.id, "改名"), { ok: true, value: undefined });
      const avatarPath = `${a.id}/avatar/${crypto.randomUUID()}.jpg`;
      privatePaths.push(avatarPath);
      assertEquals((await a.client.storage.from("recipe-media").upload(avatarPath, JPEG, { contentType: "image/jpeg" })).error, null);
      assertEquals(await syncPublicAvatar(a.client, a.id, avatarPath), { ok: true, value: undefined });
      assertEquals(await syncPublicAvatar(a.client, a.id, avatarPath), { ok: true, value: undefined });
      const profiles = await getProfiles(b.client, [a.id]);
      assert(profiles.ok);
      assertEquals(profiles.value.get(a.id)?.nickname, "小A");
      assertEquals(await status(profiles.value.get(a.id)!.avatarUrl!), 200);
      assertEquals(await syncPublicAvatar(a.client, a.id, null), { ok: true, value: undefined });
      const cleared = await getProfiles(b.client, [a.id]);
      assert(cleared.ok);
      assertEquals(cleared.value.get(a.id)?.avatarUrl, null);

      // B 重复举报 → 两次都 ok
      assertEquals(await report(b.client, b.id, { recipeId: cr.id }, "ad"), { ok: true, value: undefined });
      assertEquals(await report(b.client, b.id, { recipeId: cr.id }, "other"), { ok: true, value: undefined });

      // 评论：删两次都 ok
      const c = await addComment(b.client, b.id, cr.id, "  好吃  ");
      assert(c.ok, JSON.stringify(c));
      assertEquals(c.value.body, "好吃");
      assertEquals(await deleteComment(b.client, c.value.id), { ok: true, value: undefined });
      assertEquals(await deleteComment(b.client, c.value.id), { ok: true, value: undefined });

      // 楼中楼「回复 @某人」：B 发顶层，A 回复 B，B 再回复 A（记下 replyToUserId）
      const thread = await addComment(b.client, b.id, cr.id, "顶层");
      assert(thread.ok, JSON.stringify(thread));
      const reply1 = await addComment(a.client, a.id, cr.id, "回 B", thread.value.id);
      assert(reply1.ok, JSON.stringify(reply1));
      assertEquals(reply1.value.replyToUserId, null);
      const reply2 = await addComment(b.client, b.id, cr.id, "回 A", thread.value.id, a.id);
      assert(reply2.ok, JSON.stringify(reply2));
      assertEquals(reply2.value.replyToUserId, a.id);
      const threadList = await listComments(b.client, cr.id);
      assert(threadList.ok);
      assertEquals(threadList.value.find((x) => x.id === reply2.value.id)?.replyToUserId, a.id);
      // 回复对象不在这一楼 → 被拒
      const badReply = await addComment(a.client, a.id, cr.id, "乱指", thread.value.id, crypto.randomUUID());
      assertEquals(badReply.ok, false);

      // 公开桶不能被列举：anon 什么都列不出，B 列不出 avatars/（已发布菜的目录登录用户可读，存菜要复制）；A 自己能列
      const anon = createClient(url, anonKey, noSession);
      for (const folder of [cr.id, "avatars", ""]) {
        const l = await anon.storage.from("community-media").list(folder);
        assertEquals(l.data ?? [], [], `anon list "${folder}"`);
      }
      const bAvatars = await b.client.storage.from("community-media").list("avatars");
      assertEquals(bAvatars.data ?? [], [], "B 列不出 avatars/");
      const own = await a.client.storage.from("community-media").list(cr.id);
      assertEquals(own.data?.length, 1);

      // A 撤回 → 图拿不到；B 看不到菜、不能评论、不能取消赞
      assertEquals(await withdrawRecipe(a.client, cr.id), { ok: true, value: undefined });
      const gone = await status(publicUrl);
      assert(gone === 400 || gone === 404, `expected 400/404, got ${gone}`);
      assertEquals(await getCommunityRecipe(b.client, cr.id), { ok: false, reason: "unavailable" });
      assertEquals(await addComment(b.client, b.id, cr.id, "还在吗"), { ok: false, reason: "unavailable" });
      assertEquals(await setLike(b.client, b.id, cr.id, false), { ok: false, reason: "unavailable" });
    } finally {
      if (privatePaths.length) await admin.storage.from("recipe-media").remove(privatePaths);
      await admin.auth.admin.deleteUser(a.id);
      await admin.auth.admin.deleteUser(b.id);
    }
  },
});

Deno.test({
  name: "community api: admin removed → author's app cleans public media",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(anonKey && serviceKey, "SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 未设置");
    const admin = createClient(url, serviceKey, noSession);
    const a = await makeUser(admin, "removed");
    const privatePaths: string[] = [];
    try {
      const recipeId = crypto.randomUUID();
      const imageId = crypto.randomUUID();
      const privatePath = `${a.id}/${recipeId}/${imageId}.jpg`;
      privatePaths.push(privatePath);
      assertEquals((await a.client.storage.from("recipe-media").upload(privatePath, JPEG, { contentType: "image/jpeg" })).error, null);
      const pub = await publishRecipe(a.client, a.id, {
        id: recipeId, name: "要被下架的菜", subtitle: "", description: "", minutes: 1, difficulty: "简单",
        calories: 0, tags: [], cover: { id: imageId, path: privatePath, width: 1, height: 1 },
        ingredients: [], steps: [{ text: "x" }], custom: true,
      });
      assert(pub.ok, JSON.stringify(pub));
      const publicUrl = a.client.storage.from("community-media").getPublicUrl(pub.value.recipe.cover!.path!).data.publicUrl;
      assertEquals(await status(publicUrl), 200);

      // 管理员下架（service role 等同 Dashboard）
      const rm = await admin.from("community_recipes").update({ status: "removed" }).eq("id", pub.value.id);
      assertEquals(rm.error, null);
      // 作者不能再往里写
      const up = await a.client.storage.from("community-media")
        .upload(`${pub.value.id}/new.jpg`, JPEG, { contentType: "image/jpeg" });
      assert(up.error !== null, "removed 的目录不能再上传");
      // 作者下次启动清理 → 公开图删掉
      await cleanupWithdrawnMedia(a.client, a.id);
      const gone = await status(publicUrl);
      assert(gone === 400 || gone === 404, `expected 400/404, got ${gone}`);
    } finally {
      if (privatePaths.length) await admin.storage.from("recipe-media").remove(privatePaths);
      await admin.auth.admin.deleteUser(a.id);
    }
  },
});

Deno.test({
  name: "social api: follow / stats / block / report user",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(anonKey && serviceKey, "SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 未设置");
    const admin = createClient(url, serviceKey, noSession);
    const a = await makeUser(admin, "sa");
    const b = await makeUser(admin, "sb");
    try {
      // 关注两次都成功（第二次是主键冲突，按成功处理）
      assert((await follow(b.client, b.id, a.id)).ok);
      assert((await follow(b.client, b.id, a.id)).ok);
      const s1 = await getSocialStats(b.client, a.id);
      assert(s1.ok);
      assertEquals(s1.value, { following: 0, followers: 1, iFollow: true, followsMe: false });

      const fans = await listFollows(a.client, a.id, "followers");
      assert(fans.ok);
      assertEquals(fans.value.map((f) => f.userId), [b.id]);
      const rel = await relationsTo(a.client, a.id, [b.id, a.id]);
      assert(rel.ok);
      assertEquals(rel.value.get(b.id), "followed_by");
      assertEquals(rel.value.has(a.id), false);

      // A 拉黑 B：B 的关注被删，B 再关注失败
      assert((await block(a.client, a.id, b.id)).ok);
      assert((await block(a.client, a.id, b.id)).ok);
      const again = await follow(b.client, b.id, a.id);
      assertEquals(again, { ok: false, reason: "unavailable" });
      const s2 = await getSocialStats(a.client, a.id);
      assert(s2.ok);
      assertEquals(s2.value.followers, 0);
      const blocks = await myBlocks(a.client, a.id);
      assert(blocks.ok);
      assertEquals(blocks.value, [b.id]);
      const bSees = await myBlocks(b.client, b.id);
      assert(bSees.ok);
      assertEquals(bSees.value, []);

      // 解除后可以再关注；取关
      assert((await unblock(a.client, a.id, b.id)).ok);
      assert((await follow(b.client, b.id, a.id)).ok);
      assert((await unfollow(b.client, b.id, a.id)).ok);
      assert((await unfollow(b.client, b.id, a.id)).ok);

      // 举报用户两次都成功
      assert((await report(b.client, b.id, { userId: a.id }, "unfriendly")).ok);
      assert((await report(b.client, b.id, { userId: a.id }, "ad")).ok);

      // 没发过菜 → 空列表
      const recipes = await listUserRecipes(b.client, a.id);
      assert(recipes.ok);
      assertEquals(recipes.value, []);
    } finally {
      await admin.auth.admin.deleteUser(a.id);
      await admin.auth.admin.deleteUser(b.id);
    }
  },
});

Deno.test({
  name: "messages api: direct / unread / group / owner handover / block",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(anonKey && serviceKey, "SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 未设置");
    const admin = createClient(url, serviceKey, noSession);
    const [a, b, c, d] = [
      await makeUser(admin, "ma"),
      await makeUser(admin, "mb"),
      await makeUser(admin, "mc"),
      await makeUser(admin, "md"),
    ];
    const mutual = async (x: typeof a, y: typeof a) => {
      assert((await follow(x.client, x.id, y.id)).ok);
      assert((await follow(y.client, y.id, x.id)).ok);
    };
    try {
      await mutual(a, b);
      await mutual(a, c);
      await mutual(b, d);
      const mutuals = await listMutuals(a.client, a.id);
      assert(mutuals.ok);
      assertEquals([...mutuals.value].sort(), [b.id, c.id].sort());

      // 私信：A 开会话（重复开同一个）、发一条，B 未读 1，markRead 后 0
      const dm = await openDirect(a.client, b.id);
      assert(dm.ok, JSON.stringify(dm));
      assertEquals(await openDirect(b.client, a.id), dm);
      assertEquals(await openDirect(a.client, a.id), { ok: false, reason: "invalid" });
      const sent = await sendMessage(a.client, a.id, dm.value, "你好");
      assert(sent.ok, JSON.stringify(sent));
      assertEquals(sent.value.body, "你好");
      assertEquals(sent.value.senderId, a.id);
      const bList = await listConversations(b.client);
      assert(bList.ok);
      const bDm = bList.value.find((x) => x.id === dm.value);
      assertEquals(bDm?.unread, 1);
      assertEquals(bDm?.peerId, a.id);
      assertEquals(bDm?.lastBody, "你好");
      assert((await markRead(b.client, dm.value)).ok);
      const bList2 = await listConversations(b.client);
      assert(bList2.ok);
      assertEquals(bList2.value.find((x) => x.id === dm.value)?.unread, 0);
      const history = await listMessages(b.client, dm.value);
      assert(history.ok);
      assertEquals(history.value.map((m) => m.id), [sent.value.id]);
      const older = await listMessages(b.client, dm.value, { createdAt: sent.value.createdAt, id: sent.value.id });
      assert(older.ok);
      assertEquals(older.value, []);

      // 群：A 拉 B、C；非互关的人拉不进
      assertEquals(await createGroup(a.client, "饭搭子", [b.id, d.id]), { ok: false, reason: "not_mutual" });
      const g = await createGroup(a.client, "饭搭子", [b.id, c.id]);
      assert(g.ok, JSON.stringify(g));
      const info = await getConversation(b.client, g.value);
      assert(info.ok);
      assertEquals(info.value, { id: g.value, kind: "group", name: "饭搭子", ownerId: a.id });
      assert((await renameGroup(a.client, g.value, "吃饭群")).ok);
      assertEquals(await renameGroup(b.client, g.value, "改名"), { ok: false, reason: "auth" });
      // B 邀请自己的互关 D；A 不关注 D 也行（只要求邀请人与被邀请人互关）
      assert((await inviteMembers(b.client, g.value, [d.id])).ok);
      assertEquals(await inviteMembers(b.client, g.value, [crypto.randomUUID()]), { ok: false, reason: "not_mutual" });
      const gMsg = await sendMessage(a.client, a.id, g.value, "群里好");
      assert(gMsg.ok, JSON.stringify(gMsg));
      const dRead = await listMessages(d.client, g.value);
      assert(dRead.ok);
      assertEquals(dRead.value.map((m) => m.id), [gMsg.value.id]);
      // D 退群后读不到
      assert((await leaveConversation(d.client, g.value)).ok);
      const dAfter = await listMessages(d.client, g.value);
      assert(dAfter.ok);
      assertEquals(dAfter.value, []);

      // A 退群 → 群主转给最早入群的成员（入群时间相同按 user_id）
      const before = await listMembers(b.client, g.value);
      assert(before.ok);
      assertEquals(before.value.length, 3);
      const heir = before.value.filter((m) => m.userId !== a.id)
        .sort((x, y) => x.joinedAt.localeCompare(y.joinedAt) || x.userId.localeCompare(y.userId))[0].userId;
      assert([b.id, c.id].includes(heir));
      assert((await leaveConversation(a.client, g.value)).ok);
      const info2 = await getConversation(b.client, g.value);
      assert(info2.ok);
      assertEquals(info2.value.ownerId, heir);
      const owner = heir === b.id ? b : c;
      const other = heir === b.id ? c : b;
      // 群主移除另一人
      assert((await removeMember(owner.client, g.value, other.id)).ok);
      const after = await listMembers(owner.client, g.value);
      assert(after.ok);
      assertEquals(after.value.map((m) => [m.userId, m.role]), [[owner.id, "owner"]]);

      // 举报消息：A 举报不了自己发的，B 可以举报 A 的
      assertEquals(await report(a.client, a.id, { messageId: sent.value.id }, "ad"), { ok: false, reason: "unavailable" });
      assert((await report(b.client, b.id, { messageId: sent.value.id }, "ad")).ok);

      // A 拉黑 B 后，B 给 A 发消息 → unavailable
      assert((await block(a.client, a.id, b.id)).ok);
      assertEquals(await sendMessage(b.client, b.id, dm.value, "还在吗"), { ok: false, reason: "unavailable" });
    } finally {
      for (const u of [a, b, c, d]) await admin.auth.admin.deleteUser(u.id);
    }
  },
});

Deno.test({
  name: "messages api: realtime INSERT reaches the other member",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(anonKey && serviceKey, "SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 未设置");
    const admin = createClient(url, serviceKey, noSession);
    const a = await makeUser(admin, "ra");
    const b = await makeUser(admin, "rb");
    let stop: (() => void) | null = null;
    try {
      assert((await follow(a.client, a.id, b.id)).ok);
      assert((await follow(b.client, b.id, a.id)).ok);
      const dm = await openDirect(a.client, b.id);
      assert(dm.ok, JSON.stringify(dm));

      const got = Promise.withResolvers<{ id: string; body: string }>();
      const subscribed = Promise.withResolvers<void>();
      stop = subscribeMessages(b.client, { conversationId: dm.value }, (m) => got.resolve(m), (s) => {
        if (s === "SUBSCRIBED") subscribed.resolve();
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") subscribed.reject(new Error(`订阅失败：${s}`));
      });
      await subscribed.promise;
      // SUBSCRIBED 之后 Realtime 还要一瞬间才把变更流接上，立刻发会漏。
      await new Promise((r) => setTimeout(r, 1000));

      const sent = await sendMessage(a.client, a.id, dm.value, "实时消息");
      assert(sent.ok, JSON.stringify(sent));
      const timer = setTimeout(() => got.reject(new Error("5 秒内没收到实时消息")), 5000);
      const m = await got.promise;
      clearTimeout(timer);
      assertEquals(m.id, sent.value.id);
      assertEquals(m.body, "实时消息");
    } finally {
      stop?.();
      await b.client.removeAllChannels();
      await admin.auth.admin.deleteUser(a.id);
      await admin.auth.admin.deleteUser(b.id);
    }
  },
});
