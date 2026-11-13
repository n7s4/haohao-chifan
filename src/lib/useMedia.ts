/**
 * 把 `StepImage[]` 变成可以直接塞进 `<Image source>` 的地址。
 *
 * 渲染顺序固定为「本地缓存 → 批量签名 URL → 占位」，但拿到签名后会在后台把文件
 * 落到 `document/recipe-media/...`：厨房里没信号时，靠的就是这一步——只给签名 URL
 * 的话断网就是整屏空白。首屏 20 张封面也只发一次 `createSignedUrls`，不是 20 个往返。
 */
import { useEffect, useMemo, useState } from "react";

import { cachedMediaFile, downloadMedia, mediaPath, signedMediaUrls } from "./media";
import type { StepImage } from "./steps";
import { useAuth } from "./useAuth";

type Ref = { userId: string | null; recipeId: string; imageId: string };
type Entry = { key: string; ref: Ref };

/**
 * 先同步返回已有的本地文件、再返回签名 URL、最后回填下载好的本地文件。
 * 三段都要回调，否则第一屏要等 20 张图下完才有内容。
 */
async function resolveEntries(
  entries: Entry[],
  emit: (uris: Record<string, string>) => void,
  alive: () => boolean
): Promise<void> {
  const next: Record<string, string> = {};
  const pending: Entry[] = [];

  for (const entry of entries) {
    const local = cachedMediaFile(entry.ref);
    if (local) next[entry.key] = local.uri;
    else pending.push(entry);
  }
  if (alive()) emit(next);
  if (!pending.length) return;

  let signed: Record<string, string> = {};
  try {
    signed = await signedMediaUrls(pending.map((entry) => entry.ref));
  } catch {
    // 签名失败就留着本地那部分，调用方回落成插画/首字占位。
    return;
  }

  const withUrls = { ...next };
  for (const entry of pending) {
    const path = mediaPath(entry.ref);
    const url = path ? signed[path] : undefined;
    if (url) withUrls[entry.key] = url;
  }
  if (alive()) emit(withUrls);

  // 后台落盘；downloadMedia 内部已有 3 并发限制，这里不要另开并发。
  const downloads = await Promise.all(
    pending.map(async (entry) => {
      const url = withUrls[entry.key];
      if (!url) return null;
      const local = await downloadMedia(entry.ref, url);
      return local ? ([entry.key, local] as const) : null;
    })
  );
  if (!downloads.some(Boolean)) return;
  const cached = { ...withUrls };
  for (const pair of downloads) if (pair) cached[pair[0]] = pair[1];
  if (alive()) emit(cached);
}

/** 详情页 / 新建页：一个菜谱里的封面和步骤图。 */
export function useMediaUris(
  recipeId: string | undefined,
  images: (StepImage | undefined | null)[]
): Record<string, string> {
  const { userId } = useAuth();
  // key 一起存下来：换成另一个菜谱的那一帧不该把上一条的地址当成本条的。
  const [state, setState] = useState<{ key: string; uris: Record<string, string> }>({
    key: "",
    uris: {},
  });
  // 依赖用「id + path + 有没有临时文件」拼串：数组每次渲染都是新引用，直接进依赖会死循环。
  const key = images
    .filter((image): image is StepImage => Boolean(image))
    .map((image) => `${image.id}:${image.path ?? ""}:${image.localUri ? "local" : ""}`)
    .join("|");

  useEffect(() => {
    let active = true;
    const list = images.filter((image): image is StepImage => Boolean(image));
    const entries: Entry[] = [];
    for (const image of list) {
      if (image.localUri) continue;
      if (!recipeId) continue;
      // 不要求 path：刚落盘、还没上传的图只有本地缓存，这时候必须立刻命中，
      // 否则会先掉回插画占位，等签名 URL 才亮——就是用户看到的「过一会才显示」。
      entries.push({ key: image.id, ref: { userId, recipeId, imageId: image.id } });
    }
    if (!entries.length) return;
    void resolveEntries(
      entries,
      (next) => setState({ key, uris: next }),
      () => active
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, recipeId, userId]);

  // 本机已缓存的图在第一帧就同步给出，不用等 effect 回填再闪一下。
  const cachedNow = useMemo(() => {
    const out: Record<string, string> = {};
    if (!recipeId) return out;
    for (const image of images) {
      if (!image || image.localUri) continue;
      const local = cachedMediaFile({ userId, recipeId, imageId: image.id });
      if (local) out[image.id] = local.uri;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, recipeId, userId]);

  // 刚选完、还没落盘的图用 localUri 直接预览，其余都从解析结果里取。
  const inline: Record<string, string> = {};
  for (const image of images) {
    if (image?.localUri) inline[image.id] = image.localUri;
  }
  return { ...cachedNow, ...(state.key === key ? state.uris : {}), ...inline };
}

/** 发现页一屏 20 张封面：一次 `createSignedUrls` 签完，不要每张卡各签一次。 */
export function useRecipeCoverUris(
  recipes: { id: string; cover?: StepImage }[]
): Record<string, string> {
  const { userId } = useAuth();
  const [state, setState] = useState<{ key: string; uris: Record<string, string> }>({
    key: "",
    uris: {},
  });
  const key = recipes
    .filter((recipe) => Boolean(recipe.cover) && (recipe.cover?.path || recipe.cover?.localUri))
    .map(
      (recipe) =>
        `${recipe.id}:${recipe.cover?.id ?? ""}:${recipe.cover?.path ?? ""}:${recipe.cover?.localUri ? "local" : ""}`
    )
    .join("|");

  useEffect(() => {
    let active = true;
    const entries: Entry[] = [];
    for (const recipe of recipes) {
      const cover = recipe.cover;
      if (!cover || cover.localUri) continue;
      entries.push({ key: recipe.id, ref: { userId, recipeId: recipe.id, imageId: cover.id } });
    }
    if (!entries.length) return;
    void resolveEntries(
      entries,
      (next) => setState({ key, uris: next }),
      () => active
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId]);

  // 刚选完、还没落盘的封面用 localUri 直接上屏，别等缓存/签名。
  const inline: Record<string, string> = {};
  for (const recipe of recipes) {
    if (recipe.cover?.localUri) inline[recipe.id] = recipe.cover.localUri;
  }
  return { ...(state.key === key ? state.uris : {}), ...inline };
}
