import { normalizeSteps, type RecipeStep, type StepImage } from "../lib/steps";

export type ArtKind = "pasta" | "salad" | "rice" | "soup" | "toast";

export type Ingredient = {
  name: string;
  qty: number | null;
  unit: string;
  /** 调料单独一区，不进本周采购清单（盐、酱油这类通常家里常备）。 */
  section?: "seasoning";
};

export type Recipe = {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  minutes: number;
  difficulty: string;
  calories: number;
  tags: string[];
  /** 内置菜有插画；自建菜没有封面，画首字兜底，所以是可选的。 */
  art?: ArtKind;
  /** 自建菜的成品图（用户在新建页选的那张）；有图时详情页/发现页都用它替换插画。 */
  cover?: StepImage;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  heat?: string;
  tips?: string[];
  stepMinutes?: number[];
  /** 自建菜的更新时间，跨设备合并时用来判断谁更新；内置菜没有。 */
  updatedAt?: string;
  /** 用户自建（可同步、可删）；内置菜只读。 */
  custom?: boolean;
};

/** 内置菜的步骤常量仍然写成字符串，导出时统一 normalize 成对象，改一处即可。 */
type BuiltInRecipe = Omit<Recipe, "steps"> & { steps: string[] };

const builtInRecipes: BuiltInRecipe[] = [
  {
    id: "tomato-pasta",
    name: "番茄奶油意面",
    subtitle: "酸甜浓郁，一口治愈今天的小疲惫",
    description: "酸甜浓郁，一口治愈今天的小疲惫。",
    minutes: 20,
    difficulty: "简单",
    calories: 520,
    tags: ["意面", "一锅到底"],
    art: "pasta",
    ingredients: [
      { name: "意大利面", qty: 100, unit: "g" },
      { name: "小番茄", qty: 8, unit: "颗" },
      { name: "淡奶油", qty: 50, unit: "ml" },
      { name: "大蒜", qty: 2, unit: "瓣" },
      { name: "橄榄油、盐", qty: null, unit: "适量" },
    ],
    steps: [
      "煮沸清水，加入少许盐，放入意面煮至八分熟，保留一小碗煮面水。",
      "小番茄对半切开，大蒜切末。",
      "锅中倒入橄榄油，小火炒香蒜末，加入番茄炒到出汁变软。",
      "倒入淡奶油和少量煮面水，小火搅匀，煮出顺滑酱汁。",
      "放入意面拌煮一分钟，用盐调味，装盘即可。",
    ],
    heat: "中火",
    stepMinutes: [4, 2, 5, 6, 3],
    tips: [
      "留一小碗煮面水，之后能让酱汁挂得更住。",
      "番茄先去皮，酱汁会更细腻顺滑。",
      "蒜末别炒到发黄，闻到香味就够了。",
      "全程小火，奶油容易分离。",
      "关火后再拌 10 秒，酱汁更亮。",
    ],
  },
  {
    id: "avocado-bowl",
    name: "牛油果能量碗",
    subtitle: "清爽开启一天，让每一口都充满元气",
    description: "清爽开启一天，让每一口都充满元气。",
    minutes: 10,
    difficulty: "简单",
    calories: 410,
    tags: ["快手", "高蛋白"],
    art: "salad",
    ingredients: [
      { name: "牛油果", qty: 0.5, unit: "个" },
      { name: "熟藜麦", qty: 100, unit: "g" },
      { name: "生菜", qty: 50, unit: "g" },
      { name: "水煮蛋", qty: 1, unit: "个" },
      { name: "柠檬汁、橄榄油", qty: null, unit: "适量" },
    ],
    steps: [
      "生菜洗净沥干，牛油果去皮切片，水煮蛋对半切开。",
      "碗中铺上熟藜麦，依次放入生菜、牛油果和鸡蛋。",
      "淋上柠檬汁与橄榄油，撒少许盐和黑胡椒，轻轻拌匀即可。",
    ],
  },
  {
    id: "seasonal-salad",
    name: "时蔬暖心沙拉",
    subtitle: "轻盈也满足，把当季的新鲜装进碗里",
    description: "轻盈也满足，把当季的新鲜装进碗里。",
    minutes: 15,
    difficulty: "简单",
    calories: 280,
    tags: ["轻食", "当季"],
    art: "salad",
    ingredients: [
      { name: "西兰花", qty: 100, unit: "g" },
      { name: "南瓜", qty: 100, unit: "g" },
      { name: "生菜", qty: 50, unit: "g" },
      { name: "橄榄油、盐", qty: null, unit: "适量" },
    ],
    steps: [
      "西兰花和生菜洗净，南瓜去皮切成小块。",
      "南瓜上锅蒸熟，西兰花焯熟后沥干水分。",
      "全部蔬菜装碗，加入橄榄油与少许盐拌匀，趁温热享用。",
    ],
  },
  {
    id: "mushroom-rice",
    name: "香菇鸡肉焖饭",
    subtitle: "一锅端上桌的温暖主食",
    description: "一锅端上桌的温暖主食，米饭吸满鸡汤香气。",
    minutes: 35,
    difficulty: "中等",
    calories: 610,
    tags: ["一锅到底", "主食"],
    art: "rice",
    ingredients: [
      { name: "大米", qty: 150, unit: "g" },
      { name: "鸡腿肉", qty: 150, unit: "g" },
      { name: "干香菇", qty: 4, unit: "朵" },
      { name: "胡萝卜", qty: 0.5, unit: "根" },
      { name: "生抽、老抽", qty: 2, unit: "勺" },
    ],
    steps: [
      "香菇泡发切片，鸡腿肉切块，胡萝卜切丁。",
      "锅中少油，将鸡肉煎至表面金黄，加入香菇和胡萝卜炒香。",
      "倒入生抽、老抽翻匀，加入大米和泡香菇的水，水量与平时煮饭相同。",
      "全部转入电饭煲，按普通煮饭键，跳闸后焖十分钟再拌匀。",
    ],
  },
  {
    id: "pumpkin-soup",
    name: "南瓜浓汤",
    subtitle: "绵密顺口，一碗下肚胃里暖暖的",
    description: "绵密顺口，一碗下肚胃里暖暖的。",
    minutes: 25,
    difficulty: "简单",
    calories: 230,
    tags: ["汤", "暖胃"],
    art: "soup",
    ingredients: [
      { name: "南瓜", qty: 300, unit: "g" },
      { name: "洋葱", qty: 0.25, unit: "个" },
      { name: "牛奶", qty: 150, unit: "ml" },
      { name: "黄油", qty: 10, unit: "g" },
    ],
    steps: [
      "南瓜去皮切块，洋葱切小丁。",
      "锅中融化黄油，炒香洋葱至透明，加入南瓜翻炒。",
      "加水没过食材，煮十五分钟至南瓜软烂。",
      "倒入料理机打至细腻，倒回锅中加入牛奶小火加热，用盐调味。",
    ],
  },
  {
    id: "egg-toast",
    name: "一人食快手早午餐",
    subtitle: "十分钟搞定的松弛感",
    description: "十分钟搞定的松弛感，吐司配煎蛋和小番茄。",
    minutes: 8,
    difficulty: "简单",
    calories: 340,
    tags: ["快手", "早午餐"],
    art: "toast",
    ingredients: [
      { name: "全麦吐司", qty: 2, unit: "片" },
      { name: "鸡蛋", qty: 2, unit: "个" },
      { name: "小番茄", qty: 6, unit: "颗" },
      { name: "黄油", qty: 10, unit: "g" },
    ],
    steps: [
      "吐司放入烤箱或平底锅，烤到两面微脆。",
      "平底锅融化黄油，将鸡蛋煎至喜欢的熟度。",
      "小番茄对半切开，稍微煎一下出汁。",
      "把煎蛋和番茄放到吐司上，撒盐和黑胡椒即可。",
    ],
  },
];

export const recipes: Recipe[] = builtInRecipes.map((recipe) => ({
  ...recipe,
  steps: normalizeSteps(recipe.steps),
}));

export const getRecipe = (id: string) => recipes.find((recipe) => recipe.id === id);

/** 会让采购清单变长的主料：调料被排除在外。 */
export const cookingIngredients = (recipe: Recipe) => recipe.ingredients.filter((item) => item.section !== "seasoning");
export const seasoningIngredients = (recipe: Recipe) => recipe.ingredients.filter((item) => item.section === "seasoning");

/** 自建菜没有难度/热量，展示时用「—」而不是留空或显示 0。 */
export const recipeDifficulty = (recipe: Recipe) => recipe.difficulty || "—";
export const recipeCalories = (recipe: Recipe) => (recipe.calories > 0 ? `${recipe.calories} 千卡` : "—");
export const recipeMinutes = (recipe: Recipe) => (recipe.minutes > 0 ? `${recipe.minutes} 分钟` : "—");
/** 一行副标题：自建菜给个能说清来源的固定句，避免详情页空一行。 */
export const recipeSubtitle = (recipe: Recipe) =>
  recipe.subtitle || (recipe.custom ? "自己录入的菜谱" : "");

// 这轮只上「全部 / 快手菜」：轻食只有几道内置菜能进（表单没有热量输入），
// 家常菜没有可解释的判据，放出来就是点进去和「全部」一模一样的空壳。
export const categories = ["全部", "快手菜"];

export const isQuickRecipe = (recipe: Recipe) => {
  const steps = recipe.steps.filter((step) => step.text.trim().length > 0).length;
  // minutes 为 0 = 没填，不能当「0 分钟」算，否则所有老自建菜都会掉进快手菜。
  if (recipe.minutes > 0) return recipe.minutes <= 20;
  return steps > 0 && steps <= 5;
};

export const matchesCategory = (recipe: Recipe, category: string) => {
  if (category === "快手菜") return isQuickRecipe(recipe);
  return true;
};

export const mealSlots = ["早餐", "午餐", "晚餐"] as const;
export type MealSlot = (typeof mealSlots)[number];
