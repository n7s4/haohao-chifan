import { useCallback, useRef } from "react";

import { MEDIA_BUCKET } from "../media";
import { getCurrentUserId, getSupabase, isSupabaseConfigured } from "../supabase";
import { newCustomRecipeId, useStore } from "../../state/store";
import { copyToPrivate, type FailReason } from "./api";
import { type CommunityRecipe, fromSnapshot } from "./logic";

export type SaveToMineResult =
  | { ok: true; recipeId: string; existed: boolean }
  | { ok: false; reason: FailReason };

/**
 * 「存到我的菜谱」：把一道社区菜整道复制成自己的私有菜，带上 origin。
 * 已经存过（customRecipes 里有同一个 origin.communityId）就直接返回那道。
 * 图先从公开桶复制到私有桶，全部成功才建菜；复制出来的图带 path，不会再被当成待上传。
 */
export function useSaveToMine(): (cr: CommunityRecipe, authorNickname: string) => Promise<SaveToMineResult> {
  const { customRecipes, createRecipe } = useStore();
  // 同一道菜连点两下只跑一次。
  const inflight = useRef(new Map<string, Promise<SaveToMineResult>>());

  return useCallback(
    (cr, authorNickname) => {
      const saved = customRecipes.find((r) => r.origin?.communityId === cr.id);
      if (saved) return Promise.resolve({ ok: true, recipeId: saved.id, existed: true });
      const pending = inflight.current.get(cr.id);
      if (pending) return pending;

      const run = async (): Promise<SaveToMineResult> => {
        if (!isSupabaseConfigured) return { ok: false, reason: "auth" };
        const userId = await getCurrentUserId();
        if (!userId) return { ok: false, reason: "auth" };
        const recipeId = newCustomRecipeId();
        const { input, origin, copies } = fromSnapshot(cr, userId, recipeId, authorNickname);
        const client = getSupabase();
        const copied = await copyToPrivate(client, copies);
        if (!copied.ok) return copied;
        const recipe = createRecipe({ ...input, origin }, recipeId);
        if (!recipe) {
          if (copies.length) await client.storage.from(MEDIA_BUCKET).remove(copies.map((c) => c.to));
          return { ok: false, reason: "invalid" };
        }
        return { ok: true, recipeId: recipe.id, existed: false };
      };

      const p = run()
        .catch((): SaveToMineResult => ({ ok: false, reason: "network" }))
        .finally(() => inflight.current.delete(cr.id));
      inflight.current.set(cr.id, p);
      return p;
    },
    [customRecipes, createRecipe]
  );
}
