import type { FatLossMeal, Recipe } from "./recipes";

/** 专题页的分段，顺序即展示顺序。 */
export const FAT_LOSS_MEALS: { key: FatLossMeal; label: string; maxKcal: number }[] = [
  { key: "breakfast", label: "早餐", maxKcal: 400 },
  { key: "main", label: "正餐", maxKcal: 500 },
  { key: "snack", label: "加餐", maxKcal: 200 },
];

/** 正餐蛋白质下限（克）。 */
export const MAIN_MIN_PROTEIN = 25;

export const isFatLoss = (recipe: Recipe) => recipe.fatLoss !== undefined;

/** 专题里的菜：按分段顺序（早餐 → 正餐 → 加餐），同段保持数据里的顺序；meal 不传为全部。 */
export function fatLossList(all: Recipe[], meal?: FatLossMeal): Recipe[] {
  const order = FAT_LOSS_MEALS.map((m) => m.key);
  return all
    .filter((r) => r.fatLoss !== undefined && (!meal || r.fatLoss === meal))
    .sort((a, b) => order.indexOf(a.fatLoss!) - order.indexOf(b.fatLoss!));
}

/** 按 4/4/9 千卡每克换算的热量，用来核对标注的热量是否自洽。 */
export const macroKcal = (n: { protein: number; carbs: number; fat: number }) =>
  n.protein * 4 + n.carbs * 4 + n.fat * 9;
