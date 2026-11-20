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
