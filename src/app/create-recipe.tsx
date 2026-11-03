import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, Card } from "../components/Common";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from "../components/Icons";
import { cookingIngredients, seasoningIngredients } from "../data/recipes";
import { useStore } from "../state/store";
import { colors, radius, shadow, spacing } from "../theme";
import type { StepImage } from "../lib/steps";

type IngredientDraft = { key: string; name: string; qty: string; unit: string };
type StepDraft = { key: string; text: string; images?: StepImage[] };

let draftSeq = 0;
const nextKey = () => `row-${draftSeq++}`;

const emptyIngredient = (): IngredientDraft => ({ key: nextKey(), name: "", qty: "", unit: "" });
const emptyStep = (): StepDraft => ({ key: nextKey(), text: "" });

const toDrafts = (items: { name: string; qty: number | null; unit: string }[]): IngredientDraft[] =>
  items.length
    ? items.map((item) => ({
        key: nextKey(),
        name: item.name,
        qty: item.qty === null ? "" : `${item.qty}`,
        unit: item.unit,
      }))
    : [emptyIngredient()];

const parseRows = (rows: IngredientDraft[]) =>
  rows
    .map((item) => ({
      name: item.name.trim(),
      qty: item.qty.trim() ? Number(item.qty.trim()) : null,
      unit: item.unit.trim(),
    }))
    .filter((item) => item.name.length > 0);

const draftSignature = (draft: {
  name: string;
  minutes: string;
  ingredients: IngredientDraft[];
  seasonings: IngredientDraft[];
  steps: StepDraft[];
}) =>
  JSON.stringify([
    draft.name.trim(),
    draft.minutes.trim(),
    // 全空的行不算改动：新建时默认就有一行空的食材/调料/步骤。
    [draft.ingredients, draft.seasonings].map((rows) =>
      rows
        .filter((item) => item.name.trim() || item.qty.trim() || item.unit.trim())
        .map((item) => [item.name.trim(), item.qty.trim(), item.unit.trim()])
    ),
    draft.steps.map((item) => [item.text.trim(), (item.images ?? []).map((image) => image.id)]),
  ]);

const sameDraft = (a: Parameters<typeof draftSignature>[0], b: Parameters<typeof draftSignature>[0]) =>
  draftSignature(a) === draftSignature(b);

/**
 * 自己录一道菜：菜名 + 食材 + 调料 + 步骤。
 * 带 `?id=` 进来就是编辑——只有自建菜能编辑，内置/他人菜谱在这里直接被挡回。
 */
export default function CreateRecipeScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { createRecipe, updateRecipe, findRecipe } = useStore();
  const editing = typeof id === "string" && id.length > 0 ? findRecipe(id) : undefined;
  const editable = editing?.custom === true;

  const initial = useMemo(() => {
    if (!editable || !editing) return null;
    return {
      name: editing.name,
      minutes: editing.minutes > 0 ? `${editing.minutes}` : "",
      ingredients: toDrafts(cookingIngredients(editing)),
      seasonings: toDrafts(seasoningIngredients(editing)),
      steps: editing.steps.length
        ? editing.steps.map((step) => ({ key: nextKey(), text: step.text, images: step.images }))
        : [emptyStep()],
    };
  }, [editable, editing]);

  const [name, setName] = useState(initial?.name ?? "");
  const [minutes, setMinutes] = useState(initial?.minutes ?? "");
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(initial?.ingredients ?? [emptyIngredient()]);
  const [seasonings, setSeasonings] = useState<IngredientDraft[]>(initial?.seasonings ?? [emptyIngredient()]);
  const [steps, setSteps] = useState<StepDraft[]>(initial?.steps ?? [emptyStep()]);
  // 深链进来时 store 可能还没从本地 blob 水合完，`editable` 会晚一帧才有值；
  // 这里把编辑数据到位的那一刻补一次预填，否则表单是空的、一保存就把原菜洗白。
  const [hydratedId, setHydratedId] = useState<string | null>(initial ? editing?.id ?? null : null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // 上移/下移之后要把焦点带回刚动过的那一步，用户连按两次不用重新点输入框。
  const stepInputs = React.useRef<Record<string, React.ComponentRef<typeof TextInput> | null>>({});
  const [touched, setTouched] = useState(false);

  React.useEffect(() => {
    if (!initial || !editing || hydratedId === editing.id) return;
    setName(initial.name);
    setMinutes(initial.minutes);
    setIngredients(initial.ingredients);
    setSeasonings(initial.seasonings);
    setSteps(initial.steps);
    setHydratedId(editing.id);
  }, [initial, editing, hydratedId]);

  // 「和打开时不一样」才算脏：编辑模式刚打开什么都没改，不该弹确认。
  const dirty = touched
    ? true
    : !sameDraft(
        { name, minutes, ingredients, seasonings, steps },
        {
          name: initial?.name ?? "",
          minutes: initial?.minutes ?? "",
          ingredients: initial?.ingredients ?? [],
          seasonings: initial?.seasonings ?? [],
          steps: initial?.steps ?? [],
        }
      );

  const leaveNow = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const leave = () => {
    if (dirty) setConfirmLeave(true);
    else leaveNow();
  };

  React.useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!dirty) return false;
      setConfirmLeave(true);
      return true;
    });
    return () => sub.remove();
  }, [dirty]);

  const updateRow = (
    setter: React.Dispatch<React.SetStateAction<IngredientDraft[]>>,
    key: string,
    patch: Partial<IngredientDraft>
  ) => {
    setTouched(true);
    setter((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  /** 上下移动一步；焦点跟着被移动的那一步走，连续点两次不用重新点输入框。 */
  const moveStep = (key: string, delta: -1 | 1) => {
    setTouched(true);
    setSteps((current) => {
      const from = current.findIndex((row) => row.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    requestAnimationFrame(() => stepInputs.current[key]?.focus());
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("先给这道菜起个名字");
      return;
    }
    const parsedIngredients = parseRows(ingredients);
    const parsedSeasonings = parseRows(seasonings);
    if (!parsedIngredients.length && !parsedSeasonings.length) {
      setError("至少填一样食材或调料");
      return;
    }
    const allRows = [...parsedIngredients, ...parsedSeasonings];
    if (allRows.some((item) => item.qty !== null && !Number.isFinite(item.qty))) {
      setError("数量只能填数字，或者留空");
      return;
    }
    const parsedSteps = steps
      .filter((item) => item.text.trim().length > 0)
      .map((item) => ({
        text: item.text.trim(),
        ...(item.images?.length ? { images: item.images } : {}),
      }));
    const minutesValue = minutes.trim() ? Number(minutes.trim()) : 0;
    const input = {
      name: trimmed,
      minutes: Number.isFinite(minutesValue) && minutesValue > 0 ? Math.round(minutesValue) : null,
      ingredients: parsedIngredients,
      seasonings: parsedSeasonings,
      steps: parsedSteps,
    };

    const recipe = editable && editing ? updateRecipe(editing.id, input) : createRecipe(input);
    if (!recipe) {
      setError("保存失败，检查一下菜名和食材");
      return;
    }
    // 深链直接进来的（没有上一页）退回详情，别把用户留在已经保存过的表单上。
    if (router.canGoBack()) router.back();
    else router.replace(`/recipe/${recipe.id}`);
  };

  if (id && !editable) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 48, paddingHorizontal: spacing.xl }]}>
        <AppText size={17} weight="800">这道菜不能编辑</AppText>
        <AppText size={13} color={colors.muted} style={{ marginTop: spacing.sm, lineHeight: 20 }}>
          只有自己录入的菜谱可以改，系统自带的菜谱是只读的。
        </AppText>
        <Pressable onPress={leaveNow} style={{ marginTop: spacing.xl }} accessibilityRole="button">
          <AppText size={14} weight="600" color={colors.green}>返回</AppText>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
          <Pressable onPress={leave} hitSlop={12} accessibilityRole="button" accessibilityLabel="返回">
            <AppText size={15} color={colors.muted}>‹ 返回</AppText>
          </Pressable>
          <AppText size={24} weight="800" style={{ marginTop: spacing.lg, letterSpacing: -0.3 }}>
            {editable ? "编辑这道菜" : "自己录一道菜"}
          </AppText>
          <AppText size={12} color={colors.muted} style={{ marginTop: 6, lineHeight: 19 }}>
            填好菜名、食材和步骤，保存后就能排进菜单、自动算进采购清单。
          </AppText>
        </View>

        <View style={styles.body}>
          <Card style={styles.card}>
            <AppText size={11} weight="600" color={colors.muted}>菜名</AppText>
            <TextInput
              value={name}
              onChangeText={(value) => {
                setTouched(true);
                setName(value);
                setError(null);
              }}
              placeholder="比如 番茄鸡蛋面"
              placeholderTextColor="#A5AB98"
              style={styles.input}
              returnKeyType="done"
            />
            <AppText size={11} weight="600" color={colors.muted} style={{ marginTop: spacing.md }}>
              大概用时（分钟，可不填）
            </AppText>
            <TextInput
              value={minutes}
              onChangeText={(value) => {
                setTouched(true);
                setMinutes(value);
              }}
              placeholder="20"
              placeholderTextColor="#A5AB98"
              style={styles.input}
              keyboardType="number-pad"
            />
          </Card>

          <Card style={styles.card}>
            <View style={styles.sectionHead}>
              <View style={{ flex: 1 }}>
                <AppText size={13} weight="700">食材</AppText>
                <AppText size={10} color={colors.muted} style={{ marginTop: 2 }}>会算进本周采购清单</AppText>
              </View>
              <Pressable
                onPress={() => {
                  setTouched(true);
                  setIngredients((current) => [...current, emptyIngredient()]);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="添加一样食材"
              >
                <AppText size={12} weight="600" color={colors.green}>+ 加一样</AppText>
              </Pressable>
            </View>
            {ingredients.map((item) => (
              <View key={item.key} style={styles.ingredientRow}>
                <TextInput
                  value={item.name}
                  onChangeText={(value) => updateRow(setIngredients, item.key, { name: value })}
                  placeholder="食材名"
                  placeholderTextColor="#A5AB98"
                  style={[styles.input, styles.ingredientName]}
                />
                <TextInput
                  value={item.qty}
                  onChangeText={(value) => updateRow(setIngredients, item.key, { qty: value })}
                  placeholder="数量"
                  placeholderTextColor="#A5AB98"
                  style={[styles.input, styles.ingredientQty]}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  value={item.unit}
                  onChangeText={(value) => updateRow(setIngredients, item.key, { unit: value })}
                  placeholder="单位"
                  placeholderTextColor="#A5AB98"
                  style={[styles.input, styles.ingredientUnit]}
                />
                <Pressable
                  onPress={() =>
                    setIngredients((current) =>
                      current.length > 1 ? current.filter((row) => row.key !== item.key) : current
                    )
                  }
                  hitSlop={8}
                  style={styles.rowRemove}
                  accessibilityRole="button"
                  accessibilityLabel="删除这样食材"
                >
                  <TrashIcon size={15} color={colors.muted} />
                </Pressable>
              </View>
            ))}
            <AppText size={10} color={colors.muted} style={{ marginTop: spacing.sm, lineHeight: 16 }}>
              单位写 g、ml、个、瓣都行；数量留空表示「适量」。
            </AppText>
          </Card>

          <Card style={styles.card}>
            <View style={styles.sectionHead}>
              <View style={{ flex: 1 }}>
                <AppText size={13} weight="700">调料</AppText>
                <AppText size={10} color={colors.muted} style={{ marginTop: 2 }}>只记在菜谱里，不进采购清单</AppText>
              </View>
              <Pressable
                onPress={() => {
                  setTouched(true);
                  setSeasonings((current) => [...current, emptyIngredient()]);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="添加一样调料"
              >
                <AppText size={12} weight="600" color={colors.green}>+ 加一样</AppText>
              </Pressable>
            </View>
            {seasonings.map((item) => (
              <View key={item.key} style={styles.ingredientRow}>
                <TextInput
                  value={item.name}
                  onChangeText={(value) => updateRow(setSeasonings, item.key, { name: value })}
                  placeholder="调料名"
                  placeholderTextColor="#A5AB98"
                  style={[styles.input, styles.ingredientName]}
                />
                <TextInput
                  value={item.qty}
                  onChangeText={(value) => updateRow(setSeasonings, item.key, { qty: value })}
                  placeholder="数量"
                  placeholderTextColor="#A5AB98"
                  style={[styles.input, styles.ingredientQty]}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  value={item.unit}
                  onChangeText={(value) => updateRow(setSeasonings, item.key, { unit: value })}
                  placeholder="单位"
                  placeholderTextColor="#A5AB98"
                  style={[styles.input, styles.ingredientUnit]}
                />
                <Pressable
                  onPress={() =>
                    setSeasonings((current) =>
                      current.length > 1 ? current.filter((row) => row.key !== item.key) : current
                    )
                  }
                  hitSlop={8}
                  style={styles.rowRemove}
                  accessibilityRole="button"
                  accessibilityLabel="删除这样调料"
                >
                  <TrashIcon size={15} color={colors.muted} />
                </Pressable>
              </View>
            ))}
          </Card>

          <Card style={styles.card}>
            <View style={styles.sectionHead}>
              <AppText size={13} weight="700">步骤</AppText>
              <Pressable
                onPress={() => {
                  setTouched(true);
                  setSteps((current) => [...current, emptyStep()]);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="添加一步"
              >
                <AppText size={12} weight="600" color={colors.green}>+ 加一步</AppText>
              </Pressable>
            </View>
            {steps.map((item, index) => (
              <View key={item.key} style={styles.stepRow}>
                <View style={styles.stepIndex}>
                  <AppText size={11} weight="700" color={colors.green}>{index + 1}</AppText>
                </View>
                <TextInput
                  ref={(node) => {
                    stepInputs.current[item.key] = node;
                  }}
                  value={item.text}
                  onChangeText={(value) => {
                    setTouched(true);
                    setSteps((current) =>
                      current.map((row) => (row.key === item.key ? { ...row, text: value } : row))
                    );
                  }}
                  placeholder="这一步怎么做"
                  placeholderTextColor="#A5AB98"
                  style={[styles.input, styles.stepInput]}
                  multiline
                />
                {steps.length > 1 ? (
                  <View style={styles.stepOrder}>
                    {index > 0 ? (
                      <Pressable
                        onPress={() => moveStep(item.key, -1)}
                        hitSlop={6}
                        style={styles.stepOrderButton}
                        accessibilityRole="button"
                        accessibilityLabel={`上移第 ${index + 1} 步`}
                      >
                        <ChevronUpIcon size={13} color={colors.muted} />
                      </Pressable>
                    ) : null}
                    {index < steps.length - 1 ? (
                      <Pressable
                        onPress={() => moveStep(item.key, 1)}
                        hitSlop={6}
                        style={styles.stepOrderButton}
                        accessibilityRole="button"
                        accessibilityLabel={`下移第 ${index + 1} 步`}
                      >
                        <ChevronDownIcon size={13} color={colors.muted} />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                <Pressable
                  onPress={() =>
                    setSteps((current) =>
                      current.length > 1 ? current.filter((row) => row.key !== item.key) : current
                    )
                  }
                  hitSlop={8}
                  style={styles.rowRemove}
                  accessibilityRole="button"
                  accessibilityLabel="删除这一步"
                >
                  <TrashIcon size={15} color={colors.muted} />
                </Pressable>
              </View>
            ))}
            <AppText size={10} color={colors.muted} style={{ marginTop: spacing.sm, lineHeight: 16 }}>
              步骤不填也能保存，之后做的时候照着记忆来。
            </AppText>
          </Card>

          {error ? (
            <AppText size={12} color={colors.orangeText} style={styles.error}>{error}</AppText>
          ) : null}

        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable
          onPress={save}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={editable ? "保存修改" : "保存这道菜"}
        >
          <AppText size={14} weight="700" color={colors.cream}>
            {editable ? "保存修改" : "保存"}
          </AppText>
        </Pressable>
      </View>
      {confirmLeave ? (
        <ConfirmDialog
          title="这道菜还没保存"
          message="现在离开，刚填的菜名、食材和步骤都会丢掉。"
          cancelLabel="继续填"
          confirmLabel="丢弃并离开"
          destructive
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            leaveNow();
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: spacing.xl },
  body: { paddingHorizontal: spacing.xl, gap: spacing.md, marginTop: spacing.xl },
  card: { padding: 14, ...shadow.card },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  input: {
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: "#F5F5EE",
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.ink,
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  ingredientName: { flex: 1 },
  ingredientQty: { width: 64, textAlign: "center", paddingHorizontal: 0 },
  ingredientUnit: { width: 56, textAlign: "center", paddingHorizontal: 0 },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: spacing.sm,
  },
  stepIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 11,
  },
  stepInput: { flex: 1, minHeight: 72, paddingTop: 11, paddingBottom: 11, textAlignVertical: "top" },
  rowRemove: { width: 26, height: 44, alignItems: "center", justifyContent: "center" },
  stepOrder: { width: 22, gap: 2, marginTop: 8 },
  stepOrderButton: { width: 22, height: 26, alignItems: "center", justifyContent: "center" },
  error: { lineHeight: 18, marginTop: spacing.xs },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.cream,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    // 向上的一层浅阴影，滚到底时最后一步不会贴死在按钮边上。
    shadowColor: "#3A4230",
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  button: {
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
});
