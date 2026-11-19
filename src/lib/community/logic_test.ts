import { assert, assertEquals } from "jsr:@std/assert";
import {
  applyLikeToggle,
  canSaveToMine,
  COMMENT_MAX,
  commentActions,
  commentLength,
  commentTime,
  likeAfterLookup,
  type CommunityRecipe,
  mergeFavoriteEntries,
  mergeFeedPage,
  type CommentRow,
  communityFavoriteId,
  communityIdFor,
  defaultNickname,
  favoriteIdFor,
  fromSnapshot,
  missingUploads,
  parseCommunityFavoriteId,
  planPool,
  publishMenu,
  replyParentId,
  threadComments,
  toSnapshot,
  validateCommentBody,
  validateNickname,
} from "./logic.ts";
import type { Recipe } from "../../data/recipes.ts";

const recipe: Recipe = {
  id: "r1",
  name: "番茄蛋",
  subtitle: "s",
  description: "d",
  minutes: 10,
  difficulty: "简单",
  calories: 100,
  tags: ["蛋"],
  cover: { id: "c1", path: "u1/r1/c1.jpg", width: 10, height: 10, localUri: "file:///x" },
  ingredients: [
    { name: "番茄", qty: 1, unit: "个" },
    { name: "盐", qty: null, unit: "适量", section: "seasoning" },
  ],
  steps: [
    { text: "切", images: [{ id: "i1", path: "u1/r1/i1.jpg", localUri: "file:///y" }] },
    { text: "炒", images: [{ id: "i2", path: "u1/r1/i2.jpg" }, { id: "i3", path: "u1/r1/i3.jpg" }] },
  ],
  custom: true,
  updatedAt: "2026-01-01",
};

Deno.test("favorite ids", () => {
  assertEquals(communityFavoriteId("abc"), "community:abc");
  assertEquals(parseCommunityFavoriteId("community:abc"), "abc");
  assertEquals(parseCommunityFavoriteId("tomato-pasta"), null);
});

Deno.test("favoriteIdFor", () => {
  const base = { id: "uuid-1", authorId: "u1", sourceRecipeId: "priv-1", builtin: false };
  assertEquals(favoriteIdFor({ ...base, builtin: true, authorId: null, sourceRecipeId: "tomato-pasta" }, "u1"), "tomato-pasta");
  assertEquals(favoriteIdFor(base, "u1"), "priv-1");
  assertEquals(favoriteIdFor(base, "u2"), "community:uuid-1");
  assertEquals(favoriteIdFor(base, null), "community:uuid-1");
});

Deno.test("planPool", () => {
  assertEquals(planPool(["a", "community:x"], ["a", "b"]), ["a"]);
  assertEquals(planPool(["community:x"], ["a", "b"]), ["a", "b"]);
});

Deno.test("defaultNickname", () => {
  assert(/^吃饭的人\d{4}$/.test(defaultNickname(() => 0.0421)));
  assertEquals(defaultNickname(() => 0.0421), "吃饭的人0421");
  assertEquals(defaultNickname(() => 0.9999999), "吃饭的人9999");
});

Deno.test("validateNickname", () => {
  assertEquals(validateNickname("me@qq.com").ok, false);
  assertEquals(validateNickname("   ").ok, false);
  assertEquals(validateNickname("a".repeat(21)).ok, false);
  assertEquals(validateNickname("🍜".repeat(20)).ok, true);
  const r = validateNickname("  小王  ");
  assert(r.ok && r.value === "小王");
});

Deno.test("validateNickname: 不能冒充官方", () => {
  for (const s of ["好好吃饭", "  好好吃饭  ", "好好 吃饭", "好好吃饭官方", "官方小助手", "ＯＫ官方"]) {
    assertEquals(validateNickname(s).ok, false, s);
  }
  assert(validateNickname("好好做饭").ok);
  assert(validateNickname("吃饭的人1234").ok);
});

Deno.test("validateCommentBody", () => {
  assertEquals(validateCommentBody(" \n "), { ok: false, error: "empty" });
  assertEquals(validateCommentBody("🍜".repeat(500)).ok, true);
  assertEquals(validateCommentBody("a".repeat(501)), { ok: false, error: "too_long" });
  assertEquals(validateCommentBody(" hi "), { ok: true, value: "hi" });
});

Deno.test("missingUploads", () => {
  assertEquals(missingUploads(recipe), 0);
  assertEquals(
    missingUploads({
      cover: { id: "c1", path: "p" },
      steps: [{ text: "a", images: [{ id: "x", path: "p" }, { id: "y" }] }, { text: "b" }],
    }),
    1,
  );
  assertEquals(missingUploads({ steps: [{ text: "a", images: [{ id: "y" }] }] }), 1);
});

Deno.test("toSnapshot", () => {
  const { row, copies } = toSnapshot(recipe, "cid");
  assert(!JSON.stringify(row).includes("localUri"));
  assertEquals(row.id, "cid");
  assertEquals(row.source_recipe_id, "r1");
  assertEquals(row.step_minutes, []);
  assertEquals(copies.length, 4);
  assertEquals(copies[0], { from: "u1/r1/c1.jpg", to: "cid/c1.jpg" });
  assertEquals((row.cover as { path: string }).path, "cid/c1.jpg");
  assertEquals((row.steps as Recipe["steps"])[1].images?.[1].path, "cid/i3.jpg");
  assertEquals(recipe.cover?.path, "u1/r1/c1.jpg"); // 不改入参
});

Deno.test("fromSnapshot", () => {
  const { row } = toSnapshot(recipe, "cid");
  const cr = {
    id: "cid", authorId: "u1", sourceRecipeId: "r1", builtin: false, status: "published" as const,
    likeCount: 0, commentCount: 0, publishedAt: null,
    recipe: {
      name: "番茄蛋", subtitle: "s", description: "d", minutes: 10, difficulty: "简单", calories: 100,
      tags: ["蛋"], cover: row.cover as Recipe["cover"],
      ingredients: row.ingredients as Recipe["ingredients"], steps: row.steps as Recipe["steps"],
    },
  };
  const out = fromSnapshot(cr, "u2", "new1", "小王");
  assertEquals(out.origin, { communityId: "cid", authorNickname: "小王" });
  assertEquals(out.input.name, "番茄蛋");
  assertEquals(out.input.minutes, 10);
  assertEquals(out.input.subtitle, "s");
  assertEquals(out.input.description, "d");
  assertEquals(out.input.difficulty, "简单");
  assertEquals(out.input.calories, 100);
  assertEquals(out.input.tags, ["蛋"]);
  assert(!JSON.stringify(out.input).includes("localUri"));
  assertEquals(out.input.ingredients.map((i) => i.name), ["番茄"]);
  assertEquals(out.input.seasonings?.map((i) => i.name), ["盐"]);
  assertEquals(out.input.cover?.path, "u2/new1/c1.jpg");
  assertEquals(out.input.steps[0].images?.[0].path, "u2/new1/i1.jpg");
  assertEquals(out.copies.length, 4);
  assertEquals(out.copies[0], { from: "cid/c1.jpg", to: "u2/new1/c1.jpg" });
});

Deno.test("fromSnapshot: 完整复制可选字段；没 path 的图丢掉、不进复制清单", () => {
  const cr = {
    id: "cid", authorId: "u1", sourceRecipeId: "r1", builtin: false, status: "published" as const,
    likeCount: 0, commentCount: 0, publishedAt: null,
    recipe: {
      name: "红烧肉", subtitle: "", description: "", minutes: 60, difficulty: "中等", calories: 800,
      tags: ["肉"], art: "rice" as const, heat: "小火", tips: ["慢炖"], stepMinutes: [5, 55],
      cover: { id: "c1", width: 4, height: 3 },
      ingredients: [{ name: "五花肉", qty: 500, unit: "g" }],
      steps: [
        { text: "焯水", images: [{ id: "i1", path: "cid/i1.jpg" }, { id: "i2" }] },
        { text: "炖" },
        { text: "收汁", images: [{ id: "i3" }] },
      ],
    },
  };
  const out = fromSnapshot(cr, "u2", "new1", "小李");
  assertEquals(out.input.art, "rice");
  assertEquals(out.input.heat, "小火");
  assertEquals(out.input.tips, ["慢炖"]);
  assertEquals(out.input.stepMinutes, [5, 55]);
  assertEquals(out.input.subtitle, "");
  assertEquals(out.input.cover, null); // 封面没 path → 丢掉
  assertEquals(out.input.steps[0].images, [{ id: "i1", path: "u2/new1/i1.jpg" }]); // i2 没 path → 丢掉
  assert(!("images" in out.input.steps[2]), "全是没 path 的图 → 不留空 images");
  assertEquals(out.copies, [{ from: "cid/i1.jpg", to: "u2/new1/i1.jpg" }]);
  assertEquals(cr.recipe.steps[0].images?.[0].path, "cid/i1.jpg"); // 不改入参
});

Deno.test("fromSnapshot: 社区菜缺省的可选字段不出现在 input 里", () => {
  const cr = {
    id: "cid", authorId: null, sourceRecipeId: "tomato-pasta", builtin: true, status: "published" as const,
    likeCount: 0, commentCount: 0, publishedAt: null,
    recipe: {
      name: "面", subtitle: "", description: "", minutes: 0, difficulty: "", calories: 0, tags: [],
      ingredients: [{ name: "面", qty: 1, unit: "把" }], steps: [{ text: "煮" }],
    },
  };
  const out = fromSnapshot(cr, "u2", "new1", "好好吃饭");
  for (const k of ["art", "heat", "tips", "stepMinutes"]) assert(!(k in out.input), k);
  assertEquals(out.input.cover, null);
  assertEquals(out.copies, []);
});

Deno.test("threadComments", () => {
  const c = (id: string, parentId: string | null, createdAt: string, deleted = false): CommentRow => ({
    id, parentId, userId: "u", body: id, deleted, createdAt,
  });
  const rows = [
    c("a", null, "2026-01-01"),
    c("b", null, "2026-01-02", true), // 已删无回复 -> 丢
    c("d", null, "2026-01-03", true), // 已删有回复 -> 留
    c("d2", "d", "2026-01-05"),
    c("d1", "d", "2026-01-04"),
    c("d3", "d", "2026-01-06", true), // 已删回复 -> 丢
    c("e", null, "2026-01-07"),
  ];
  const t = threadComments(rows);
  assertEquals(t.map((x) => x.comment.id), ["e", "d", "a"]);
  assertEquals(t[1].replies.map((r) => r.id), ["d1", "d2"]);
});

Deno.test("applyLikeToggle", () => {
  assertEquals(applyLikeToggle({ liked: false, count: 3 }), {
    next: { liked: true, count: 4 },
    rollback: { liked: false, count: 3 },
  });
  assertEquals(applyLikeToggle({ liked: true, count: 0 }), {
    next: { liked: false, count: 0 },
    rollback: { liked: true, count: 0 },
  });
  assertEquals(applyLikeToggle({ liked: true, count: 5 }).next, { liked: false, count: 4 });
});

Deno.test("communityIdFor: 稳定、uuid 形状、不依赖 crypto.randomUUID", () => {
  const original = globalThis.crypto.randomUUID;
  (globalThis.crypto as unknown as { randomUUID: unknown }).randomUUID = undefined;
  try {
    const a = communityIdFor("u1", "r1");
    assertEquals(a, communityIdFor("u1", "r1"));
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a), a);
    assert(a !== communityIdFor("u1", "r2"));
    assert(a !== communityIdFor("u2", "r1"));
  } finally {
    globalThis.crypto.randomUUID = original;
  }
});

Deno.test("mergeFeedPage: 追加新一页，按 id 去重（翻页期间有新发布导致偏移）", () => {
  const a = (id: string) => ({ id }) as never;
  const r = mergeFeedPage([a("1"), a("2")], [a("2"), a("3")], 2);
  assertEquals(r.items.map((x: { id: string }) => x.id), ["1", "2", "3"]);
  assertEquals(r.hasMore, true);
});

Deno.test("mergeFeedPage: 返回不足一页即没有更多", () => {
  const r = mergeFeedPage([], [{ id: "1" } as never], 20);
  assertEquals(r.items.length, 1);
  assertEquals(r.hasMore, false);
});

Deno.test("canSaveToMine：内置菜和自己发布的菜不显示，别人的菜（含未登录）显示", () => {
  const cr = { authorId: "u1", builtin: false };
  assertEquals(canSaveToMine(cr, "u2"), true);
  assertEquals(canSaveToMine(cr, null), true);
  assertEquals(canSaveToMine(cr, "u1"), false);
  assertEquals(canSaveToMine({ authorId: null, builtin: true }, "u2"), false);
  assertEquals(canSaveToMine({ authorId: null, builtin: true }, null), false);
});

Deno.test("likeAfterLookup：本地不知道赞没赞时，查到已赞只同步显示，查到没赞才发点赞", () => {
  assertEquals(likeAfterLookup(true), "sync");
  assertEquals(likeAfterLookup(false), "toggle");
});


Deno.test("replyParentId：回复只挂一层，回复的回复挂到顶层", () => {
  const top: CommentRow = { id: "a", parentId: null, userId: "u1", body: "x", deleted: false, createdAt: "1" };
  const reply: CommentRow = { id: "b", parentId: "a", userId: "u2", body: "y", deleted: false, createdAt: "2" };
  assertEquals(replyParentId(top), "a");
  assertEquals(replyParentId(reply), "a");
});

Deno.test("commentActions：本人或菜的作者可删，别人的评论可举报", () => {
  const c: CommentRow = { id: "a", parentId: null, userId: "u1", body: "x", deleted: false, createdAt: "1" };
  assertEquals(commentActions(c, "u1", "author"), ["delete"]);
  assertEquals(commentActions(c, "author", "author"), ["delete", "report"]);
  assertEquals(commentActions(c, "u2", "author"), ["report"]);
  assertEquals(commentActions(c, null, "author"), ["report"]);
  // 内置菜没有作者：只有本人能删
  assertEquals(commentActions(c, "u2", null), ["report"]);
  assertEquals(commentActions({ ...c, userId: "author" }, "author", "author"), ["delete"]);
  // 已删除（显示「该评论已删除」）的不弹操作
  assertEquals(commentActions({ ...c, deleted: true }, "u1", "author"), []);
});

Deno.test("commentLength：trim 后按码点计", () => {
  assertEquals(commentLength("  好吃😋  "), 3);
  assertEquals(commentLength("   "), 0);
  assertEquals(COMMENT_MAX, 500);
});

Deno.test("commentTime：相对时间", () => {
  const now = new Date(2026, 10, 19, 12, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  assertEquals(commentTime(ago(20 * 1000), now), "刚刚");
  assertEquals(commentTime(ago(5 * 60 * 1000), now), "5 分钟前");
  assertEquals(commentTime(ago(3 * 3600 * 1000), now), "3 小时前");
  assertEquals(commentTime(ago(2 * 86400 * 1000), now), "2 天前");
  assertEquals(commentTime(new Date(2026, 0, 5, 9).toISOString(), now), "1月5日");
  assertEquals(commentTime(new Date(2025, 11, 30, 9).toISOString(), now), "2025年12月30日");
  // 时钟偏差导致的「未来时间」也算刚刚；解析不了的给空串
  assertEquals(commentTime(new Date(now.getTime() + 60000).toISOString(), now), "刚刚");
  assertEquals(commentTime("bad", now), "");
});

Deno.test("publishMenu：没发过 / 已撤回 → 发布；已发布 → 更新、撤回、在社区查看；被下架 → 没有操作", () => {
  assertEquals(publishMenu(null), ["publish"]);
  assertEquals(publishMenu({ status: "withdrawn" }), ["publish"]);
  assertEquals(publishMenu({ status: "published" }), ["update", "withdraw", "view"]);
  assertEquals(publishMenu({ status: "removed" }), []);
});

Deno.test("mergeFavoriteEntries: 保持收藏顺序，本地菜和社区菜混排", () => {
  const cr = { id: "u1" } as CommunityRecipe;
  const out = mergeFavoriteEntries(
    ["b1", "community:u1", "gone", "community:u2"],
    new Set(["b1", "gone"]),
    { state: "ok", rows: [cr], requested: ["u1", "u2"] },
  );
  assertEquals(out, [
    { kind: "local", id: "b1" },
    { kind: "community", favId: "community:u1", cr },
    { kind: "local", id: "gone" },
    { kind: "removed", favId: "community:u2" },
  ]);
});

Deno.test("mergeFavoriteEntries: 本地查不到的收藏跳过（和原来一致）", () => {
  const out = mergeFavoriteEntries(["x", "y"], new Set(["y"]), { state: "ok", rows: [], requested: [] });
  assertEquals(out, [{ kind: "local", id: "y" }]);
});

Deno.test("mergeFavoriteEntries: 拉取失败不算已下架", () => {
  const out = mergeFavoriteEntries(["a", "community:u1"], new Set(["a"]), { state: "failed" });
  assertEquals(out, [{ kind: "local", id: "a" }, { kind: "unloaded", favId: "community:u1", failed: true }]);
});

Deno.test("mergeFavoriteEntries: 加载中显示未加载占位，不算已下架", () => {
  const out = mergeFavoriteEntries(["community:u1"], new Set(), { state: "loading" });
  assertEquals(out, [{ kind: "unloaded", favId: "community:u1", failed: false }]);
});

Deno.test("mergeFavoriteEntries: 重复的社区收藏只出现一次", () => {
  const out = mergeFavoriteEntries(["community:u1", "community:u1"], new Set(), { state: "failed" });
  assertEquals(out.length, 1);
});

Deno.test("mergeFavoriteEntries: 上次没请求过的新收藏按加载中处理，不算已下架", () => {
  const out = mergeFavoriteEntries(["community:new"], new Set(), { state: "ok", rows: [], requested: ["old"] });
  assertEquals(out, [{ kind: "unloaded", favId: "community:new", failed: false }]);
});
