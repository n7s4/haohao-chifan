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
import {
  addComment,
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
