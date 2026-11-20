import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, usePressScale } from "../../../components/Common";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Avatar } from "../../../components/community/Avatar";
import { GroupNameSheet } from "../../../components/community/GroupNameSheet";
import { MutualPicker, useMutuals } from "../../../components/community/MutualPicker";
import { ActionSheet } from "../../../components/community/ReportSheet";
import { BackIcon, CloseIcon, PlusIcon } from "../../../components/Icons";
import { Toast, useToast } from "../../../components/Toast";
import { getProfiles, type PublicProfile } from "../../../lib/community/api";
import {
  type ConversationInfo,
  getConversation,
  inviteMembers,
  leaveConversation,
  listMembers,
  type MemberEntry,
  removeMember,
  renameGroup,
} from "../../../lib/community/messages";
import { GROUP_MAX_MEMBERS, toggleSelected } from "../../../lib/community/messagesLogic";
import { FALLBACK_NICKNAME } from "../../../lib/community/socialLogic";
import { failMessage } from "../../../lib/community/useCommunityProfile";
import { getSupabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/useAuth";
import { colors, radius, shadow, spacing } from "../../../theme";

const IS_ANDROID = Platform.OS === "android";
const ICON_BTN = IS_ANDROID ? 48 : 44;

const goBack = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/messages");
};

type Load =
  | { status: "loading" }
  | { status: "error"; reason: "unavailable" | "network" }
  | { status: "ready"; conv: ConversationInfo; members: MemberEntry[] };

/** 群设置：成员网格、邀请、改群名（群主）、移出成员（群主）、退出群聊。 */
export default function GroupSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { ready, userId } = useAuth();
  const { toast, showText, undo } = useToast();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [profiles, setProfiles] = useState<Map<string, PublicProfile>>(new Map());
  const [renaming, setRenaming] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchGroup = useCallback(async (): Promise<{ load: Load; profiles: Map<string, PublicProfile> | null }> => {
    const none = (l: Load) => ({ load: l, profiles: null });
    if (!id) return none({ status: "error", reason: "unavailable" });
    const client = getSupabase();
    const [c, m] = await Promise.all([
      getConversation(client, id).catch(() => null),
      listMembers(client, id).catch(() => null),
    ]);
    if (!c || !m) return none({ status: "error", reason: "network" });
    if (!c.ok) return none({ status: "error", reason: c.reason === "unavailable" ? "unavailable" : "network" });
    if (!m.ok) return none({ status: "error", reason: m.reason === "unavailable" ? "unavailable" : "network" });
    if (c.value.kind !== "group") return none({ status: "error", reason: "unavailable" });
    const p = await getProfiles(client, m.value.map((x) => x.userId)).catch(() => null);
    return { load: { status: "ready", conv: c.value, members: m.value }, profiles: p?.ok ? p.value : null };
  }, [id]);

  const apply = useCallback((r: { load: Load; profiles: Map<string, PublicProfile> | null }) => {
    setLoad(r.load);
    const p = r.profiles;
    if (p) setProfiles((prev) => new Map([...prev, ...p]));
  }, []);

  useEffect(() => {
    if (!ready || !userId) return;
    let alive = true;
    void fetchGroup().then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [ready, userId, fetchGroup, apply]);

  const refresh = useCallback(() => {
    void fetchGroup().then(apply);
  }, [fetchGroup, apply]);

  const members = useMemo(() => (load.status === "ready" ? load.members : []), [load]);
  const conv = load.status === "ready" ? load.conv : null;
  const isOwner = !!conv && conv.ownerId === userId;
  const memberIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const nameOf = (uid: string) => profiles.get(uid)?.nickname ?? FALLBACK_NICKNAME;

  const doRename = async (name: string): Promise<string | null> => {
    if (!id) return failMessage("invalid");
    const r = await renameGroup(getSupabase(), id, name).catch(() => null);
    if (!r) return failMessage("network");
    if (!r.ok) return failMessage(r.reason);
    setRenaming(false);
    setLoad((prev) => (prev.status === "ready" ? { ...prev, conv: { ...prev.conv, name } } : prev));
    return null;
  };

  const doInvite = async (ids: string[]): Promise<string | null> => {
    if (!id) return failMessage("invalid");
    const r = await inviteMembers(getSupabase(), id, ids).catch(() => null);
    if (!r) return failMessage("network");
    if (!r.ok) return failMessage(r.reason);
    setInviting(false);
    showText("已邀请");
    refresh();
    return null;
  };

  const doRemove = async () => {
    const target = confirmRemove;
    if (!target || !id || busy) return;
    setBusy(true);
    const r = await removeMember(getSupabase(), id, target).catch(() => null);
    setBusy(false);
    setConfirmRemove(null);
    if (!r || !r.ok) return showText(failMessage(r ? r.reason : "network"));
    showText("已移出群聊");
    refresh();
  };

  const doLeave = async () => {
    if (!id || busy) return;
    setBusy(true);
    const r = await leaveConversation(getSupabase(), id).catch(() => null);
    setBusy(false);
    setConfirmLeave(false);
    if (!r || !r.ok) return showText(failMessage(r ? r.reason : "network"));
    router.dismissTo("/messages");
  };

  const onMemberPress = (uid: string) => router.push(`/user/${uid}`);
  const onMemberLongPress = (uid: string) => {
    if (isOwner && uid !== userId) setMenuFor(uid);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <RoundButton label="返回" onPress={goBack}>
          <BackIcon size={22} color={colors.ink} />
        </RoundButton>
        <AppText size={IS_ANDROID ? 20 : 17} weight="700" style={IS_ANDROID ? styles.titleAndroid : styles.titleIos}>
          群设置
        </AppText>
        <View style={{ width: ICON_BTN }} />
      </View>

      {!userId && ready ? (
        <View style={styles.center}>
          <AppText size={14} color={colors.muted}>登录后可以查看群聊</AppText>
        </View>
      ) : load.status === "loading" ? (
        <View style={styles.center}><ActivityIndicator color={colors.muted} /></View>
      ) : load.status === "error" ? (
        <View style={styles.center}>
          {load.reason === "unavailable" ? (
            <AppText size={14} color={colors.muted}>这个群已经看不到了</AppText>
          ) : (
            <>
              <AppText size={14} color={colors.muted}>网络不太好，没加载出来</AppText>
              <Pressable
                onPress={() => {
                  setLoad({ status: "loading" });
                  refresh();
                }}
                style={styles.pill}
                accessibilityRole="button"
              >
                <AppText size={14} weight="700" color={colors.white}>重试</AppText>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
          <Pressable
            onPress={() => setRenaming(true)}
            disabled={!isOwner}
            style={styles.nameRow}
            accessibilityRole={isOwner ? "button" : "text"}
            accessibilityLabel={isOwner ? "修改群名" : "群名"}
          >
            <AppText size={13} color={colors.muted}>群名</AppText>
            <AppText size={16} weight="700" numberOfLines={1} style={{ flex: 1, textAlign: "right" }}>
              {load.conv.name ?? "群聊"}
            </AppText>
            {isOwner ? <AppText size={13} color={colors.muted}>修改</AppText> : null}
          </Pressable>

          <View style={styles.countRow}>
            <AppText size={13} color={colors.muted}>群成员</AppText>
            <AppText size={13} color={colors.muted}>{`${members.length}/${GROUP_MAX_MEMBERS}`}</AppText>
          </View>
          <View style={styles.grid}>
            {members.map((m) => (
              <Pressable
                key={m.userId}
                onPress={() => onMemberPress(m.userId)}
                onLongPress={() => onMemberLongPress(m.userId)}
                style={styles.cell}
                accessibilityRole="button"
                accessibilityLabel={`查看 ${nameOf(m.userId)} 的主页`}
                accessibilityHint={isOwner && m.userId !== userId ? "长按可以移出群聊" : undefined}
              >
                <Avatar uri={profiles.get(m.userId)?.avatarUrl ?? null} name={nameOf(m.userId)} size={52} />
                <AppText size={12} numberOfLines={1} style={styles.cellName}>{nameOf(m.userId)}</AppText>
                {m.role === "owner" ? (
                  <View style={styles.ownerTag}>
                    <AppText size={10} weight="700" color={colors.accentText}>群主</AppText>
                  </View>
                ) : (
                  <View style={styles.tagSpacer} />
                )}
              </Pressable>
            ))}
            {members.length < GROUP_MAX_MEMBERS ? (
              <Pressable onPress={() => setInviting(true)} style={styles.cell} accessibilityRole="button" accessibilityLabel="邀请">
                <View style={styles.inviteBox}>
                  <PlusIcon size={20} color={colors.ink} />
                </View>
                <AppText size={12} style={styles.cellName}>邀请</AppText>
                <View style={styles.tagSpacer} />
              </Pressable>
            ) : null}
          </View>

          <Pressable onPress={() => setConfirmLeave(true)} style={styles.leaveBtn} accessibilityRole="button" accessibilityLabel="退出群聊">
            <AppText size={15} weight="700" color={colors.danger}>退出群聊</AppText>
          </Pressable>
        </ScrollView>
      )}

      {renaming && conv ? (
        <GroupNameSheet initial={conv.name ?? ""} onConfirm={doRename} onCancel={() => setRenaming(false)} />
      ) : null}
      {inviting ? (
        <InviteModal
          me={userId}
          memberIds={memberIds}
          room={GROUP_MAX_MEMBERS - members.length}
          onSubmit={doInvite}
          onClose={() => setInviting(false)}
        />
      ) : null}
      {menuFor ? (
        <ActionSheet
          title={nameOf(menuFor)}
          actions={[
            {
              label: "移出群聊",
              danger: true,
              onPress: () => {
                setConfirmRemove(menuFor);
                setMenuFor(null);
              },
            },
          ]}
          onCancel={() => setMenuFor(null)}
        />
      ) : null}
      {confirmRemove ? (
        <ConfirmDialog
          title={`把 ${nameOf(confirmRemove)} 移出群聊？`}
          confirmLabel="移出"
          destructive
          onCancel={() => setConfirmRemove(null)}
          onConfirm={doRemove}
        />
      ) : null}
      {confirmLeave ? (
        <ConfirmDialog
          title="退出群聊？"
          message="退出后将不再收到这个群的消息"
          confirmLabel="退出"
          destructive
          onCancel={() => setConfirmLeave(false)}
          onConfirm={doLeave}
        />
      ) : null}
      <Toast toast={toast} bottom={insets.bottom + 24} onUndo={undo} />
    </View>
  );
}

/** 邀请：同样的多选列表，只列不在群里的互相关注的人。 */
function InviteModal({
  me,
  memberIds,
  room,
  onSubmit,
  onClose,
}: {
  me: string | null;
  memberIds: ReadonlySet<string>;
  room: number;
  onSubmit: (ids: string[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { state, reload } = useMutuals(me, memberIds);
  const { toast, showText, undo } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const canSubmit = selected.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const message = await onSubmit(selected);
    if (message) {
      setBusy(false);
      showText(message);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
          <RoundButton label="关闭" onPress={onClose}>
            <CloseIcon size={20} color={colors.ink} />
          </RoundButton>
          <AppText size={IS_ANDROID ? 20 : 17} weight="700" style={IS_ANDROID ? styles.titleAndroid : styles.titleIos}>
            邀请好友
          </AppText>
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="邀请"
            accessibilityState={{ disabled: !canSubmit, busy }}
          >
            <View style={[styles.createBtn, !canSubmit && { opacity: 0.4 }]}>
              {busy ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <AppText size={14} weight="700" color={colors.white}>{selected.length ? `邀请 (${selected.length})` : "邀请"}</AppText>
              )}
            </View>
          </Pressable>
        </View>
        {state.status === "loading" ? (
          <View style={styles.center}><ActivityIndicator color={colors.muted} /></View>
        ) : state.status === "error" ? (
          <View style={styles.center}>
            <AppText size={14} color={colors.muted}>网络不太好，没加载出来</AppText>
            <Pressable onPress={() => { void reload(); }} style={styles.pill} accessibilityRole="button">
              <AppText size={14} weight="700" color={colors.white}>重试</AppText>
            </Pressable>
          </View>
        ) : state.ids.length === 0 ? (
          <View style={styles.center}>
            <AppText size={14} color={colors.muted}>没有可以邀请的互相关注的人了</AppText>
          </View>
        ) : (
          <MutualPicker
            ids={state.ids}
            profiles={state.profiles}
            selected={selected}
            onToggle={(uid) => setSelected((s) => toggleSelected(s, uid))}
            maxSelect={room}
            bottomPad={insets.bottom + spacing.xxl}
          />
        )}
        <Toast toast={toast} bottom={insets.bottom + 24} onUndo={undo} />
      </View>
    </Modal>
  );
}

function RoundButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const press = usePressScale(0.94);
  return (
    <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      <Animated.View style={[styles.iconBtn, press.style]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 12, paddingBottom: 6, minHeight: 52 },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: ICON_BTN / 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  titleIos: { flex: 1, textAlign: "center" },
  titleAndroid: { flex: 1, paddingLeft: 4 },
  createBtn: { height: 36, minWidth: 64, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    marginTop: 8,
    paddingHorizontal: 16,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  countRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 24, marginTop: spacing.lg, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12 },
  cell: { width: "25%", alignItems: "center", paddingVertical: 8, paddingHorizontal: 4 },
  cellName: { marginTop: 6, maxWidth: "100%" },
  ownerTag: { marginTop: 3, paddingHorizontal: 6, height: 16, borderRadius: 8, backgroundColor: colors.accentSoft, justifyContent: "center" },
  tagSpacer: { height: 19 },
  inviteBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.placeholder,
    alignItems: "center",
    justifyContent: "center",
  },
  leaveBtn: {
    marginHorizontal: 20,
    marginTop: spacing.xl,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { paddingVertical: spacing.xxl, paddingHorizontal: 20, alignItems: "center", gap: spacing.md },
  pill: { height: 38, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
});
