import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { listCommunity } from "../../lib/community/api";
import { type CommunityRecipe, mergeFeedPage } from "../../lib/community/logic";
import { getSupabase } from "../../lib/supabase";
import { colors, radius, spacing } from "../../theme";
import { AppText } from "../Common";
import { coverHeightFor, RecipeTile, splitColumns } from "../RecipeTile";

const PAD = 20;
const GAP = 12;
const PAGE_SIZE = 20;
const SORTS: ["latest" | "hot", string][] = [
  ["latest", "最新"],
  ["hot", "最热"],
];

type Sort = "latest" | "hot";

/** 发现页「社区」：双列瀑布流 + 最新/最热 + 无限滚动 + 下拉刷新。游客可读，不要求登录。 */
export function CommunityFeed({ header, bottomPad = 0 }: { header?: React.ReactNode; bottomPad?: number }) {
  const { width } = useWindowDimensions();
  const columnWidth = Math.floor((width - PAD * 2 - GAP) / 2);
  const [sort, setSort] = useState<Sort>("latest");
  const [items, setItems] = useState<CommunityRecipe[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState<Record<string, boolean>>({});
  // 切换排序 / 下拉刷新后，旧请求的结果要丢掉。
  const generation = useRef(0);
  const busy = useRef(false);

  const fetchPage = useCallback(async (sortBy: Sort, offset: number) => {
    try {
      return await listCommunity(getSupabase(), { sort: sortBy, offset, limit: PAGE_SIZE });
    } catch {
      return { ok: false as const, reason: "network" as const };
    }
  }, []);

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchPage>>, keepOnError: boolean) => {
    setRefreshing(false);
    if (!r.ok) {
      // 下拉刷新失败时保留已有内容，只有首屏没数据才整页报错。
      if (!keepOnError) setStatus("error");
      return;
    }
    setItems(r.value);
    setHasMore(r.value.length >= PAGE_SIZE);
    setStatus("ready");
  }, []);

  /** 重试 / 下拉刷新 / 切排序：作废在途请求，从第一页重来。 */
  const reload = useCallback(
    async (sortBy: Sort, pullToRefresh = false) => {
      const gen = ++generation.current;
      busy.current = false;
      setLoadingMore(false);
      setMoreFailed(false);
      if (pullToRefresh) setRefreshing(true);
      else setStatus("loading");
      const r = await fetchPage(sortBy, 0);
      if (gen === generation.current) apply(r, pullToRefresh);
    },
    [fetchPage, apply]
  );

  // 首屏加载：status 初始即 loading，这里不需要同步 setState。
  useEffect(() => {
    const gen = ++generation.current;
    fetchPage("latest", 0).then((r) => {
      if (gen === generation.current) apply(r, false);
    });
    return () => {
      generation.current++;
    };
  }, [fetchPage, apply]);

  const changeSort = (next: Sort) => {
    if (next === sort) return;
    setSort(next);
    reload(next);
  };

  const loadMore = useCallback(async () => {
    if (busy.current || !hasMore || status !== "ready") return;
    busy.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    const gen = generation.current;
    const r = await fetchPage(sort, items.length);
    if (gen !== generation.current) return;
    busy.current = false;
    setLoadingMore(false);
    if (!r.ok) {
      setMoreFailed(true);
      return;
    }
    const merged = mergeFeedPage(items, r.value, PAGE_SIZE);
    setItems(merged.items);
    setHasMore(merged.hasMore);
  }, [fetchPage, hasMore, items, sort, status]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 400) loadMore();
  };

  const supabase = useMemo(() => {
    try {
      return getSupabase();
    } catch {
      return null;
    }
  }, []);
  const coverUri = (cr: CommunityRecipe) => {
    const path = cr.recipe.cover?.path;
    if (!path || !supabase) return undefined;
    return supabase.storage.from("community-media").getPublicUrl(path).data.publicUrl;
  };

  const columns = useMemo(() => {
    const measured = items.map((cr, index) => ({
      cr,
      height: coverHeightFor(cr.recipe.cover, index, columnWidth, 130, 220),
    }));
    return splitColumns(measured, (item) => item.height + 22 + 38 + 30 + GAP, GAP);
  }, [items, columnWidth]);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={64}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => reload(sort, true)} />}
    >
      {header}
      <View style={styles.sortRow} accessibilityRole="tablist">
        {SORTS.map(([key, label]) => {
          const on = sort === key;
          return (
            <Pressable
              key={key}
              onPress={() => changeSort(key)}
              style={[styles.sortBtn, on && styles.sortBtnOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <AppText size={13} weight="700" color={on ? colors.white : colors.muted}>{label}</AppText>
            </Pressable>
          );
        })}
      </View>

      {status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : status === "error" ? (
        <View style={styles.center}>
          <AppText size={15} weight="700">网络不太好</AppText>
          <AppText size={13} color={colors.muted} style={{ marginTop: 6 }}>社区的菜暂时没加载出来</AppText>
          <Pressable
            onPress={() => reload(sort)}
            style={styles.retry}
            accessibilityRole="button"
            accessibilityLabel="重试"
          >
            <AppText size={14} weight="700" color={colors.white}>重试</AppText>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted} style={{ textAlign: "center" }}>
            社区还没有菜，去发布第一道吧
          </AppText>
        </View>
      ) : (
        <>
          <View style={styles.feed}>
            {columns.map((bucket, col) => (
              <View key={col} style={{ width: columnWidth, gap: GAP }}>
                {bucket.map(({ cr, height }) => (
                  <RecipeTile
                    key={cr.id}
                    recipe={{ ...cr.recipe, id: cr.id, custom: false }}
                    artHeight={height}
                    columnWidth={columnWidth}
                    coverUri={coverUri(cr)}
                    coverFailed={coverFailed[cr.id]}
                    onCoverError={() => setCoverFailed((prev) => ({ ...prev, [cr.id]: true }))}
                    stats={{ likes: cr.likeCount, comments: cr.commentCount }}
                    onPress={() => router.push(`/community/${cr.id}`)}
                  />
                ))}
              </View>
            ))}
          </View>
          {loadingMore ? (
            <ActivityIndicator color={colors.muted} style={{ marginVertical: spacing.lg }} />
          ) : moreFailed ? (
            <Pressable onPress={loadMore} style={styles.moreFail} accessibilityRole="button">
              <AppText size={13} color={colors.muted}>网络不太好，点这里重试</AppText>
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sortRow: { flexDirection: "row", gap: 8, paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 12 },
  sortBtn: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  sortBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  feed: { flexDirection: "row", gap: GAP, paddingHorizontal: PAD },
  center: { paddingVertical: spacing.xxl, paddingHorizontal: PAD, alignItems: "center" },
  retry: {
    marginTop: spacing.lg,
    height: 40,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    justifyContent: "center",
  },
  moreFail: { alignItems: "center", paddingVertical: spacing.lg },
});
