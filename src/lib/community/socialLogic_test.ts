import { assertEquals } from "jsr:@std/assert";
import { afterToggle, followButtonLabel, followState, hideBlocked } from "./socialLogic.ts";

Deno.test("followState：四种关系", () => {
  assertEquals(followState(false, false), "none");
  assertEquals(followState(true, false), "following");
  assertEquals(followState(false, true), "followed_by");
  assertEquals(followState(true, true), "mutual");
});

Deno.test("followButtonLabel：关注 / 回关 / 已关注 / 互相关注", () => {
  assertEquals(followButtonLabel("none"), "关注");
  assertEquals(followButtonLabel("followed_by"), "回关");
  assertEquals(followButtonLabel("following"), "已关注");
  assertEquals(followButtonLabel("mutual"), "互相关注");
});

Deno.test("hideBlocked：去掉被拉黑作者的行，保留没有作者的行", () => {
  const rows = [
    { id: "1", author: "u1" },
    { id: "2", author: "u2" },
    { id: "3", author: null },
  ];
  const out = hideBlocked(rows, new Set(["u2"]), (r) => r.author);
  assertEquals(out.map((r) => r.id), ["1", "3"]);
});

Deno.test("hideBlocked：黑名单为空时原样返回同一数组", () => {
  const rows = [{ id: "1", author: "u1" }];
  assertEquals(hideBlocked(rows, new Set(), (r) => r.author), rows);
});

Deno.test("afterToggle：关注 / 回关 / 取关 / 取关互关", () => {
  assertEquals(afterToggle("none"), "following");
  assertEquals(afterToggle("followed_by"), "mutual");
  assertEquals(afterToggle("following"), "none");
  assertEquals(afterToggle("mutual"), "followed_by");
});
