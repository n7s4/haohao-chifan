import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Card } from "../components/Common";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CheckIcon, CloseIcon, PlusIcon, TrashIcon } from "../components/Icons";
import { categoryOf, ingredientCategories } from "../data/categories";
import { addDays, startOfWeek, toKey, useStore } from "../state/store";
import { colors, radius, spacing } from "../theme";

const stepOf = (unit: string) => (unit === "g" || unit === "ml" ? 10 : 1);
const HALVABLE = ["片", "瓣"];
const minOf = (unit: string) => {
  if (unit === "g" || unit === "ml") return 5;
  return HALVABLE.includes(unit) ? 0.5 : 1;
};
const clampQty = (unit: string, value: number) =>
  Number(Math.max(minOf(unit), value).toFixed(2));

export default function ShoppingListScreen() {
  const insets = useSafeAreaInsets();
  const {
    shoppingItems,
    toggleChecked,
    setQty,
    addManualItem,
    removeManualItem,
    resetChecked,
    weekDays,
    trippedCount,
    carryPending,
    undoCarry,
    carriedCount,
    weekKey,
  } = useStore();
  const [toast, setToast] = useState<string | null>(null);
  const [carryOpen, setCarryOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQtyInput] = useState("");
  const [editingQty, setEditingQty] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState("");
  const [unit, setUnit] = useState("g");

  const isCurrentWeek = weekKey === toKey(startOfWeek(new Date()));
  const isNextWeek = weekKey === toKey(addDays(startOfWeek(new Date()), 7));
  const title = isCurrentWeek ? "本周采购清单" : isNextWeek ? "下周采购清单" : "采购清单";

  const pending = useMemo(() => shoppingItems.filter((item) => !item.checked), [shoppingItems]);
  const bought = useMemo(() => shoppingItems.filter((item) => item.checked), [shoppingItems]);
  const [showBought, setShowBought] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof shoppingItems>();
    pending.forEach((item) => {
      const key = categoryOf(item.name);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    });
    return ingredientCategories
      .map((category) => ({ category, items: map.get(category) ?? [] }))
      .filter((group) => group.items.length > 0);
  }, [pending]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsed = Number(qty);
    addManualItem(trimmed, Number.isFinite(parsed) && parsed > 0 ? parsed : null, unit.trim() || "份");
    setName("");
    setQtyInput("");
    setAdding(false);
  };

  const renderRow = (item: (typeof shoppingItems)[number]) => (
    <View key={item.id} style={styles.row}>
      <Pressable
        onPress={() => toggleChecked(item.id)}
        style={[styles.check, item.checked && { backgroundColor: colors.green, borderColor: colors.green }]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked }}
        accessibilityLabel={item.name}
        hitSlop={6}
      >
        {item.checked ? <CheckIcon size={12} /> : null}
      </Pressable>
      <View style={{ flex: 1 }}>
        <AppText
          size={14}
          weight="600"
          color={item.checked ? colors.muted : colors.ink}
          style={item.checked ? { textDecorationLine: "line-through" } : undefined}
        >
          {item.name}
        </AppText>
        <AppText size={10} color={colors.muted} style={{ marginTop: 2 }} numberOfLines={1}>
          {item.sources.join(" · ")}
        </AppText>
      </View>
      <View style={styles.qtyBox}>
        <Pressable
          hitSlop={6}
          onPress={() => {
            if (item.qty === null) return;
            const next = Number((item.qty - stepOf(item.unit)).toFixed(2));
            setQty(item.id, clampQty(item.unit, next));
          }}
          accessibilityLabel="减少数量"
        >
          <AppText size={14} color={colors.muted}>−</AppText>
        </Pressable>
        {editingQty === item.id && item.qty !== null ? (
          <TextInput
            value={qtyDraft}
            onChangeText={setQtyDraft}
            keyboardType="decimal-pad"
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onBlur={() => {
              const parsed = Number(qtyDraft.replace(",", "."));
              if (qtyDraft.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
                setQty(item.id, clampQty(item.unit, parsed));
              }
              setEditingQty(null);
            }}
            onSubmitEditing={() => {
              const parsed = Number(qtyDraft.replace(",", "."));
              if (qtyDraft.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
                setQty(item.id, clampQty(item.unit, parsed));
              }
              setEditingQty(null);
            }}
            style={{
              minWidth: 48,
              width: 56,
              textAlign: "center",
              fontSize: 12,
              fontWeight: "600",
              color: colors.green,
              paddingVertical: 2,
              borderBottomWidth: 1,
              borderBottomColor: colors.green,
            }}
          />
        ) : (
          <Pressable
            hitSlop={6}
            accessibilityLabel={`修改数量，当前 ${item.qty} ${item.unit}`}
            onPress={() => {
              if (item.qty === null) return;
              setQtyDraft(String(item.qty));
              setEditingQty(item.id);
            }}
          >
            <AppText size={12} weight="600" color={colors.green} style={{ minWidth: 48, textAlign: "center" }}>
              {item.qty === null ? item.unit : `${item.qty} ${item.unit}`}
            </AppText>
          </Pressable>
        )}
        <Pressable
          hitSlop={6}
          onPress={() => setQty(item.id, Number(((item.qty ?? 0) + stepOf(item.unit)).toFixed(2)))}
          accessibilityLabel="增加数量"
        >
          <AppText size={14} color={colors.muted}>+</AppText>
        </Pressable>
      </View>
      {item.id.startsWith("manual-") ? (
        <Pressable onPress={() => removeManualItem(item.id)} hitSlop={8} accessibilityLabel="删除">
          <TrashIcon size={14} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="关闭">
          <CloseIcon size={20} />
        </Pressable>
        <AppText size={16} weight="800">{title}</AppText>
        <Pressable onPress={() => setAdding(true)} hitSlop={10} accessibilityLabel="添加食材">
          <PlusIcon size={18} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 170 }} showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText size={13} color={colors.green} weight="600">
              {weekDays[0].slice(5).replace("-", "/")} — {weekDays[6].slice(5).replace("-", "/")}
            </AppText>
            <Pressable
              hitSlop={8}
              accessibilityLabel="分享清单"
              onPress={() => {
                const lines = pending.map((item) => `· ${item.name}${item.qty !== null ? ` ${item.qty}${item.unit}` : ""}`);
                Share.share({
                  message: `${title}（${pending.length} 项）\n${lines.join("\n")}`,
                  title,
                }).catch(() => {});
              }}
            >
              <AppText size={11} weight="600" color="#DCE4D4">分享</AppText>
            </Pressable>
          </View>
          <AppText size={11} color="#DCE4D4" style={{ marginTop: 4 }}>
            {shoppingItems.length === 0 && carriedCount > 0
              ? `${carriedCount} 项已带到下周，这一周不用再买了`
              : trippedCount >= shoppingItems.length && shoppingItems.length > 0
                ? "全部买齐了，开火吧"
                : `已完成 ${trippedCount} / ${shoppingItems.length} 项 · 还剩 ${pending.length} 项待买`}
          </AppText>
          <View style={styles.summaryBar}>
            <View
              style={[
                styles.summaryFill,
                { width: `${shoppingItems.length ? (trippedCount / shoppingItems.length) * 100 : 0}%` },
              ]}
            />
          </View>
        </View>

        {adding ? (
          <Card style={styles.addCard}>
            <AppText size={13} weight="700">手动添加食材</AppText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="食材名称，例如 香菜"
              placeholderTextColor="#A5AB98"
              style={styles.input}
              autoFocus
              returnKeyType="next"
            />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <TextInput
                value={qty}
                onChangeText={setQtyInput}
                placeholder="数量"
                keyboardType="decimal-pad"
                placeholderTextColor="#A5AB98"
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput
                value={unit}
                onChangeText={setUnit}
                placeholder="单位"
                placeholderTextColor="#A5AB98"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
              <Pressable onPress={() => setAdding(false)} style={[styles.addAction, { backgroundColor: colors.greenSoft }]}>
                <AppText size={13} weight="600" color={colors.green}>取消</AppText>
              </Pressable>
              <Pressable onPress={submit} style={[styles.addAction, { backgroundColor: colors.orangeText }]}>
                <AppText size={13} weight="700" color={colors.cream}>添加到清单</AppText>
              </Pressable>
            </View>
          </Card>
        ) : null}

        {grouped.map((group) => (
          <View key={group.category} style={styles.section}>
            <View style={styles.groupHead}>
              <AppText size={11} weight="700" color={colors.green} style={{ letterSpacing: 0.6 }}>
                {group.category}
              </AppText>
              <AppText size={10} color={colors.muted}>{group.items.length} 项</AppText>
            </View>
            <Card style={{ paddingHorizontal: spacing.lg }}>
              {group.items.map((item, index) => (
                <View key={item.id} style={index > 0 ? styles.rowDivider : undefined}>
                  {renderRow(item)}
                </View>
              ))}
            </Card>
          </View>
        ))}

        {pending.length === 0 ? (
          <View style={styles.empty}>
            <AppText size={14} weight="700" color={colors.green}>
              {carriedCount > 0 ? "这一周已经处理完" : "这一周都买齐了"}
            </AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 6 }}>
              {carriedCount > 0
                ? `没买的 ${carriedCount} 项已带到下周，可从底部撤销`
                : "勾掉的食材都在下面的「已购买」里，随时可以撤销"}
            </AppText>
          </View>
        ) : null}

        {bought.length > 0 ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setShowBought((value) => !value)}
              style={styles.boughtHead}
              accessibilityLabel="已购买，点开查看"
            >
              <AppText size={12} weight="600" color={colors.green}>
                已购买 {bought.length} 项 {showBought ? "⌃" : "⌄"}
              </AppText>
              <Pressable onPress={() => setResetOpen(true)} hitSlop={8}>
                <AppText size={11} color={colors.orangeText}>全部撤销</AppText>
              </Pressable>
            </Pressable>
            <Card style={{ paddingHorizontal: spacing.lg, backgroundColor: "#FAF9F3", display: showBought ? "flex" : "none" }}>
              {bought.map((item, index) => (
                <View key={item.id} style={index > 0 ? styles.rowDivider : undefined}>
                  {renderRow(item)}
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>

      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + 168 }]} pointerEvents="none">
          <AppText size={12} weight="600" color={colors.cream}>{toast}</AppText>
        </View>
      ) : null}

      {resetOpen ? (
        <ConfirmDialog
          title={`撤销全部 ${bought.length} 项？`}
          message="这些食材会重新回到未购买状态，已手改的数量不会丢。"
          confirmLabel="全部撤销"
          destructive
          onCancel={() => setResetOpen(false)}
          onConfirm={() => {
            setResetOpen(false);
            resetChecked();
          }}
        />
      ) : null}

      {carryOpen ? (
        <ConfirmDialog
          title={`把未买的 ${pending.length} 项带到下周？`}
          message="只搬还没勾选的食材，下周已经有的同类会合并数量，已买的不动，也不会覆盖下周的菜单。"
          confirmLabel="带到下周"
          onCancel={() => setCarryOpen(false)}
          onConfirm={() => {
            setCarryOpen(false);
            const result = carryPending();
            setToast(
              result.moved === 0
                ? "这周没有未买的食材"
                : `已带到下周：${result.moved} 项${result.merged > 0 ? `，其中 ${result.merged} 项已合并数量` : ""}`
            );
            setTimeout(() => setToast(null), 2600);
          }}
        />
      ) : null}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {carriedCount > 0 ? (
          <Pressable
            style={styles.carryButton}
            accessibilityRole="button"
            accessibilityLabel={`撤销顺延 ${carriedCount} 项`}
            onPress={() => {
              undoCarry();
              setToast("已撤销，这些食材回到待买");
              setTimeout(() => setToast(null), 2600);
            }}
          >
            <AppText size={11} color={colors.muted}>
              已把 {carriedCount} 项带到下周 · 撤销
            </AppText>
          </Pressable>
        ) : null}
        {pending.length > 0 ? (
          <Pressable
            style={styles.carryButton}
            accessibilityRole="button"
            accessibilityLabel={`把未买的 ${pending.length} 项带到下周`}
            onPress={() => setCarryOpen(true)}
          >
            <AppText size={12} weight="600" color={colors.green}>
              未买的 {pending.length} 项带到下周
            </AppText>
          </Pressable>
        ) : null}
        <Pressable style={styles.doneButton} onPress={() => router.back()}>
          <AppText size={15} weight="700" color={colors.cream}>
            完成，返回菜单
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  summary: {
    margin: spacing.xl,
    marginBottom: 0,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.green,
  },
  summaryBar: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginTop: spacing.md,
    overflow: "hidden",
  },
  summaryFill: { height: 5, borderRadius: 3, backgroundColor: colors.orange },
  groupHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  boughtHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  empty: {
    marginTop: spacing.xxl,
    marginHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
  },
  addCard: { marginHorizontal: spacing.xl, marginTop: spacing.lg, padding: spacing.lg },
  input: {
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: "#F5F5EE",
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.ink,
  },
  addAction: { flex: 1, height: 42, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 13 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#C9CEBB",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBox: { flexDirection: "row", alignItems: "center", gap: 2 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.cream,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  carryButton: {
    height: 44,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  toast: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.green,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  doneButton: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
});
