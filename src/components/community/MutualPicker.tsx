import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";

import { getProfiles, type PublicProfile } from "../../lib/community/api";
import { listMutuals } from "../../lib/community/messages";
import { pickableMutuals } from "../../lib/community/messagesLogic";
import { FALLBACK_NICKNAME } from "../../lib/community/socialLogic";
import { useBlocks } from "../../lib/community/useBlocks";
import { getSupabase } from "../../lib/supabase";
import { colors, radius } from "../../theme";
import { AppText } from "../Common";
import { CheckIcon } from "../Icons";
import { Avatar } from "./Avatar";

export type MutualsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; ids: string[]; profiles: Map<string, PublicProfile> };

type Raw = { status: "loading" } | { status: "error" } | { status: "ready"; mutuals: string[]; profiles: Map<string, PublicProfile> };

/** 拉我的互相关注列表（去掉我拉黑的人和 exclude 里的人），并补昵称头像。 */
export function useMutuals(me: string | null, exclude?: ReadonlySet<string>) {
  const { blocked } = useBlocks();
  const [raw, setRaw] = useState<Raw>({ status: "loading" });

  const fetchAll = useCallback(async (): Promise<Raw | null> => {
    if (!me) return null;
    const client = getSupabase();
    const r = await listMutuals(client, me).catch(() => null);
    if (!r || !r.ok) return { status: "error" };
    const p = r.value.length ? await getProfiles(client, r.value).catch(() => null) : null;
    return { status: "ready", mutuals: r.value, profiles: p?.ok ? p.value : new Map() };
  }, [me]);

  useEffect(() => {
    let alive = true;
    void fetchAll().then((next) => {
      if (alive && next) setRaw(next);
    });
    return () => {
      alive = false;
    };
  }, [fetchAll]);

  const reload = useCallback(() => {
    setRaw({ status: "loading" });
    void fetchAll().then((next) => next && setRaw(next));
  }, [fetchAll]);

  const state = useMemo<MutualsState>(
    () =>
      raw.status === "ready"
        ? { status: "ready", ids: pickableMutuals(raw.mutuals, blocked, exclude), profiles: raw.profiles }
        : raw,
    [raw, blocked, exclude],
  );

  return { state, reload };
}

/** 多选列表：每行头像 + 昵称 + 勾选圈；maxSelect 到顶后其余行不可再选。 */
export function MutualPicker({
  ids,
  profiles,
  selected,
  onToggle,
  maxSelect,
  header,
  bottomPad,
}: {
  ids: string[];
  profiles: Map<string, PublicProfile>;
  selected: string[];
  onToggle: (id: string) => void;
  maxSelect?: number;
  header?: React.ReactElement;
  bottomPad: number;
}) {
  const full = maxSelect !== undefined && selected.length >= maxSelect;
  return (
    <FlatList
      data={ids}
      keyExtractor={(id) => id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      renderItem={({ item }) => {
        const p = profiles.get(item);
        const name = p?.nickname ?? FALLBACK_NICKNAME;
        const on = selected.includes(item);
        const disabled = !on && full;
        return (
          <Pressable
            onPress={() => onToggle(item)}
            disabled={disabled}
            style={[styles.row, disabled && { opacity: 0.4 }]}
            accessibilityRole="checkbox"
            accessibilityLabel={name}
            accessibilityState={{ checked: on, disabled }}
          >
            <Avatar uri={p?.avatarUrl ?? null} name={name} size={44} />
            <AppText size={15} weight="700" numberOfLines={1} style={{ flex: 1 }}>{name}</AppText>
            <View style={[styles.check, on && styles.checkOn]}>{on ? <CheckIcon size={14} color={colors.white} /> : null}</View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.placeholder,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.ink, borderColor: colors.ink },
});
