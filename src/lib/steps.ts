/**
 * 菜谱步骤。以前是 `string[]`，现在每步可以挂图，所以升成对象。
 *
 * 兼容两种历史形态（云端老行、导入的旧备份都是纯字符串）：
 * `normalizeSteps` 是唯一的转换入口，pull / 内置常量 / 导入都走它，
 * 别在各自的读点写 `typeof s === "string"` 兜底。
 */
export type StepImage = {
  /** 全局唯一的图片 id，选图那一刻生成；不用步骤下标，步骤能上下移动。 */
  id: string;
  /** Storage 里的相对路径 `{userId}/{recipeId}/{imageId}.jpg`；游客期为空。 */
  path?: string;
  /** 压缩后（上传前）的真实像素，瀑布流按它算比例。 */
  width?: number;
  height?: number;
};

export type RecipeStep = {
  text: string;
  images?: StepImage[];
};

export function normalizeStepImages(value: unknown): StepImage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : "",
      path: typeof item.path === "string" && item.path ? item.path : undefined,
      width: typeof item.width === "number" && Number.isFinite(item.width) ? item.width : undefined,
      height: typeof item.height === "number" && Number.isFinite(item.height) ? item.height : undefined,
    }))
    .filter((image) => image.id.length > 0)
    // 只有本地文件、还没上传的图，path 是空的；这种也要留着，扫盘上传靠它。
    .map((image) => image as StepImage);
  return images.length ? images : undefined;
}

/** 云端一行 / 旧备份的 steps → `RecipeStep[]`，纯字符串按步文本处理。 */
export function normalizeSteps(value: unknown): RecipeStep[] {
  if (!Array.isArray(value)) return [];
  const steps: RecipeStep[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) steps.push({ text: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : "";
    if (!text.trim()) continue;
    const images = normalizeStepImages(record.images);
    steps.push(images ? { text, images } : { text });
  }
  return steps;
}

/** 只要文本时用这个，别在 JSX 里写 `step.text` 的字面散落一堆。 */
export function stepTexts(steps: RecipeStep[]): string[] {
  return steps.map((step) => step.text);
}
