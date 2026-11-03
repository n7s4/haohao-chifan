export const ingredientCategories = ["主食", "蔬菜", "肉蛋奶", "调味", "其他"] as const;
export type IngredientCategory = (typeof ingredientCategories)[number];

const rules: [IngredientCategory, string[]][] = [
  ["肉蛋奶", ["蛋", "鸡", "牛", "猪", "虾", "芝士", "奶油", "牛奶", "酸奶", "培根", "三文鱼"]],
  ["蔬菜", ["菜", "番茄", "牛油果", "南瓜", "香菇", "蘑菇", "蒜", "葱", "柠檬", "藜麦", "玉米", "胡萝卜", "洋葱"]],
  ["调味", ["油", "盐", "胡椒", "酱", "醋", "糖", "香料", "蜂蜜", "柠檬汁"]],
  ["主食", ["面", "米", "饭", "面包", "吐司", "燕麦", "粉丝"]],
];

export const categoryOf = (name: string): IngredientCategory => {
  for (const [category, keywords] of rules) {
    if (keywords.some((keyword) => name.includes(keyword))) return category;
  }
  return "其他";
};
