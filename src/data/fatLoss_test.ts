import { assert, assertEquals } from "jsr:@std/assert";
import { FAT_LOSS_MEALS, MAIN_MIN_PROTEIN, fatLossList, macroKcal } from "./fatLoss.ts";
import { recipes } from "./recipes.ts";

const list = fatLossList(recipes);

Deno.test("减脂餐：12～15 道，早餐 / 正餐 / 加餐都有", () => {
  assert(list.length >= 12 && list.length <= 15, `共 ${list.length} 道`);
  for (const m of FAT_LOSS_MEALS) assert(fatLossList(recipes, m.key).length > 0, m.label);
});

Deno.test("减脂餐：热量不超上限，正餐蛋白质达标，营养数据自洽", () => {
  for (const r of list) {
    const meal = FAT_LOSS_MEALS.find((m) => m.key === r.fatLoss)!;
    assert(r.calories > 0 && r.calories <= meal.maxKcal, `${r.name} ${r.calories} 千卡超过${meal.label}上限`);
    assert(r.nutrition, `${r.name} 缺营养数据`);
    if (r.fatLoss === "main") assert(r.nutrition.protein >= MAIN_MIN_PROTEIN, `${r.name} 蛋白质不足`);
    const diff = Math.abs(macroKcal(r.nutrition) - r.calories) / r.calories;
    assert(diff <= 0.1, `${r.name} 三大营养素换算 ${macroKcal(r.nutrition)} 与标注 ${r.calories} 相差过大`);
  }
});

Deno.test("减脂餐：id 唯一，每步都有时长和小贴士", () => {
  assertEquals(new Set(recipes.map((r) => r.id)).size, recipes.length);
  for (const r of list) {
    assert(r.tags.includes("减脂餐"), r.name);
    assertEquals(r.stepMinutes?.length, r.steps.length, `${r.name} stepMinutes`);
    assertEquals(r.tips?.length, r.steps.length, `${r.name} tips`);
  }
});

Deno.test("fatLossList 按早餐 → 正餐 → 加餐排序，可按分段筛选", () => {
  const order = list.map((r) => r.fatLoss);
  assertEquals(order, [...order].sort((a, b) => ["breakfast", "main", "snack"].indexOf(a!) - ["breakfast", "main", "snack"].indexOf(b!)));
  assert(fatLossList(recipes, "snack").every((r) => r.fatLoss === "snack"));
});
