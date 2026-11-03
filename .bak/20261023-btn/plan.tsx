import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, GhostButton, Pill } from "../../components/Common";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DraggableMeal } from "../../components/DraggableMeal";
import { FoodArt } from "../../components/FoodArt";
import { PlusIcon, SwapIcon, TrashIcon } from "../../components/Icons";
import { MealSlot, mealSlots, recipes } from "../../data/recipes";
import { PlanMap, addDays, parseKey, recipeFor, startOfWeek, toKey, useStore } from "../../state/store";
import { colors, radius, spacing } from "../../theme";

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

const weekdayOf = (key: string) => `周${weekdayLabels[(parseKey(key).getDay() + 6) % 7]}`;

export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const {
    plan,
    weekDays,
    shiftWeek,
    selectedDate,
    setSelectedDate,
    clearDay,
    applyPlan,
    planThreeDays,
    shoppingItems,
    favorites,
    toggleFavorite,
    weekKey,
  } = useStore();
  const currentWeekKey = toKey(startOfWeek(new Date()));
  const nextWeekKey = toKey(addDays(startOfWeek(new Date()), 7));
  const listTitle =
    weekKey === currentWeekKey ? "本周采购清单" : weekKey === nextWeekKey ? "下周采购清单" : "这一周的采购清单";
  const [draft, setDraft] = useState<PlanMap | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ dateKey: string; slot: MealSlot } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; run: () => void } | null>(null);
  const [dragging, setDragging] = useState<{ dateKey: string; slot: MealSlot } | null>(null);
  const [dragTarget, setDragTarget] = useState<{ date: string; slot: MealSlot | null } | null>(null);
  const dragTargetRef = React.useRef<{ date: string; slot: MealSlot | null } | null>(null);
  const setTarget = (next: { date: string; slot: MealSlot | null } | null) => {
    const prev = dragTargetRef.current;
    if (prev?.date === next?.date && prev?.slot === next?.slot) return;
    dragTargetRef.current = next;
    setDragTarget(next);
  };
  const [slotMenu, setSlotMenu] = useState<{ dateKey: string; slot: MealSlot } | null>(null);
  const dayColumns = React.useRef<Record<string, { x: number; width: number }>>({});
  const dayRefs = React.useRef<Record<string, React.ComponentRef<typeof View> | null>>({});
  const rowRects = React.useRef<Record<string, { top: number; bottom: number }>>({});
  const rowRefs = React.useRef<Record<string, React.ComponentRef<typeof View> | null>>({});

  const measureDays = () => {
    Object.entries(dayRefs.current).forEach(([key, node]) => {
      node?.measureInWindow((x, _y, width) => {
        dayColumns.current[key] = { x, width };
      });
    });
    Object.entries(rowRefs.current).forEach(([key, node]) => {
      node?.measureInWindow((_x, top, _w, height) => {
        rowRects.current[key] = { top, bottom: top + height };
      });
    });
  };

  const ROW_GAP = 12;

  const rowAt = (pageY: number): MealSlot | null => {
    const hits = Object.entries(rowRects.current).filter(
      ([, rect]) => pageY >= rect.top && pageY <= rect.bottom
    );
    if (hits.length === 0) return null;
    const inside = hits.find(
      ([, rect]) => pageY >= rect.top + ROW_GAP / 2 && pageY <= rect.bottom - ROW_GAP / 2
    );
    return inside ? (inside[0] as MealSlot) : null;
  };

  const editing = draft !== null;
  const view = draft ?? plan;
  const dirty = useMemo(
    () => (draft ? JSON.stringify(draft) !== JSON.stringify(plan) : false),
    [draft, plan]
  );
  const dayPlan = view[selectedDate] ?? {};
  const weekEmpty = weekDays.every((key) => Object.keys(view[key] ?? {}).length === 0);
  const todayIndex = weekDays.indexOf(toKey(new Date()));
  const remainingDays = todayIndex >= 0 ? Math.min(3, weekDays.length - todayIndex) : 3;
  const fillLabel = remainingDays >= 3 ? "帮我排 3 天" : remainingDays === 1 ? "帮我排今天" : `帮我排剩下的 ${remainingDays} 天`;
  const selectedDateObject = parseKey(selectedDate);
  const weekLabel = useMemo(() => {
    const first = parseKey(weekDays[0]);
    const last = parseKey(weekDays[6]);
    return `${first.getMonth() + 1} 月 ${first.getDate()} 日 — ${last.getMonth() + 1} 月 ${last.getDate()} 日`;
  }, [weekDays]);

  const openPicker = (dateKey: string, slot: MealSlot) => setSheet({ dateKey, slot });

  const editMeal = (dateKey: string, slot: MealSlot, recipeId: string | null) => {
    if (!draft) return;
    const day = { ...(draft[dateKey] ?? {}) };
    if (recipeId) day[slot] = recipeId;
    else delete day[slot];
    setDraft({ ...draft, [dateKey]: day });
  };

  const choose = (recipeId: string) => {
    if (!sheet) return;
    editMeal(sheet.dateKey, sheet.slot, recipeId);
    setSheet(null);
  };

  const startEdit = () => setDraft(JSON.parse(JSON.stringify(plan)) as PlanMap);

  const saveEdit = () => {
    if (draft) applyPlan(draft);
    setDraft(null);
    setToast("已更新本周菜单");
    setTimeout(() => setToast(null), 2200);
  };

  const cancelEdit = () => {
    if (!dirty) {
      setDraft(null);
      return;
    }
    setConfirm({
      title: "放弃这次修改？",
      message: "本次调整不会保存。",
      label: "放弃",
      run: () => setDraft(null),
    });
  };

  const moveMeal = (fromDate: string, slot: MealSlot, delta: number) => {
    const targetDate = toKey(addDays(parseKey(fromDate), delta));
    if (!weekDays.includes(targetDate)) return;
    const recipeId = view[fromDate]?.[slot];
    if (!recipeId) return;
    editMeal(fromDate, slot, null);
    editMeal(targetDate, slot, recipeId);
  };

  const DAY_DROP_PAD = 6;

  const dayAt = (pageX: number) => {
    let best: { key: string; distance: number } | null = null;
    for (const [key, rect] of Object.entries(dayColumns.current)) {
      if (pageX < rect.x - DAY_DROP_PAD || pageX > rect.x + rect.width + DAY_DROP_PAD) continue;
      const distance = Math.abs(pageX - (rect.x + rect.width / 2));
      if (!best || distance < best.distance) best = { key, distance };
    }
    return best ? best.key : null;
  };

  const moveMealTo = (fromDate: string, fromSlot: MealSlot, targetDate: string, toSlot: MealSlot) => {
    if (!weekDays.includes(targetDate)) return;
    if (fromDate === targetDate && fromSlot === toSlot) return;
    if (!draft) return;
    const moving = draft[fromDate]?.[fromSlot];
    if (!moving) return;
    const target = draft[targetDate]?.[toSlot];
    if (fromDate === targetDate) {
      const day = { ...(draft[fromDate] ?? {}) };
      if (target) day[fromSlot] = target;
      else delete day[fromSlot];
      day[toSlot] = moving;
      setDraft({ ...draft, [fromDate]: day });
      return;
    }
    const fromDay = { ...(draft[fromDate] ?? {}) };
    const toDay = { ...(draft[targetDate] ?? {}) };
    if (target) fromDay[fromSlot] = target;
    else delete fromDay[fromSlot];
    toDay[toSlot] = moving;
    setDraft({ ...draft, [fromDate]: fromDay, [targetDate]: toDay });
  };

  const clearSelectedDay = () => {
    setConfirm({
      title: "清空这一天的菜单？",
      message: "早、午、晚三餐都会移除，可以再重新安排。",
      label: "清空",
      run: () => {
        if (draft) setDraft({ ...draft, [selectedDate]: {} });
        else clearDay(selectedDate);
      },
    });
  };

  const isToday = selectedDate === toKey(new Date());

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: editing ? 92 : spacing.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
          <AppText size={13} weight="700" color={colors.green} style={{ letterSpacing: 1 }}>
            03 / 规划每一餐
          </AppText>
          <View style={styles.titleRow}>
            <AppText size={25} weight="800" style={{ letterSpacing: -0.3 }}>
              这一周，好好吃饭
            </AppText>
            <Pressable onPress={() => (editing ? saveEdit() : startEdit())} hitSlop={8}>
              <AppText size={13} weight="600" color={editing ? colors.green : colors.orangeText}>
                {editing ? "保存" : "编辑"}
              </AppText>
            </Pressable>
          </View>

          <View style={styles.weekNav}>
            <Pressable onPress={() => shiftWeek(-1)} hitSlop={8} accessibilityLabel="上一周">
              <AppText size={16} color={colors.muted}>‹</AppText>
            </Pressable>
            <AppText size={13} color={colors.muted}>
              {weekLabel}
            </AppText>
            <Pressable onPress={() => shiftWeek(1)} hitSlop={8} accessibilityLabel="下一周">
              <AppText size={16} color={colors.muted}>›</AppText>
            </Pressable>
          </View>

          <View style={styles.days}>
            {weekDays.map((key, index) => {
              const date = parseKey(key);
              const active = key === selectedDate;
              const planned = Object.keys(view[key] ?? {}).length;
              const changed =
                editing && JSON.stringify(view[key] ?? {}) !== JSON.stringify(plan[key] ?? {});
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    if (dragging) return;
                    setSelectedDate(key);
                  }}
                  hitSlop={4}
                  ref={(node) => {
                    dayRefs.current[key] = node;
                  }}
                  onLayout={measureDays}
                  style={[
                    styles.day,
                    active && styles.dayActive,
                    dragTarget?.date === key && !active && styles.dayDropTarget,
                    dragTarget?.date === key && active && styles.dayDropTargetActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <AppText size={11} color={active ? "#D5DFCB" : colors.muted}>
                    {weekdayLabels[index]}
                  </AppText>
                  <AppText size={15} weight="700" color={active ? colors.cream : colors.ink} style={{ marginTop: 3 }}>
                    {date.getDate()}
                  </AppText>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: changed
                          ? colors.orange
                          : planned > 0
                            ? active
                              ? "#D5DFCB"
                              : "#C3CBB6"
                            : "transparent",
                      },
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        {weekEmpty && !editing ? (
          <View style={styles.emptyWeek}>
            <AppText size={13} weight="700" color={colors.green}>
              这一周还是空的
            </AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 4, lineHeight: 18 }}>
              先按收藏和菜谱库给你排满三天，之后随时能改。
            </AppText>
            <Pressable
              onPress={() => {
                const placed = planThreeDays();
                setToast(placed > 0 ? `已排好 ${placed} 餐，可以继续调整` : "这几天已经排满了");
                setTimeout(() => setToast(null), 2400);
              }}
              style={styles.emptyWeekCta}
              hitSlop={{ top: 3, bottom: 3 }}
              accessibilityLabel={fillLabel}
            >
              <AppText size={12} weight="700" color={colors.cream}>{fillLabel}</AppText>
            </Pressable>
          </View>
        ) : null}

        {editing ? (
          <View style={styles.hintBar}>
            <AppText size={11} color={colors.green}>
              调整先存草稿，保存才生效 · 长按卡片可拖到别的日期或餐次
            </AppText>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.dayTitleRow}>
            <AppText size={17} weight="800">
              {isToday ? "今天" : `${selectedDateObject.getMonth() + 1} 月 ${selectedDateObject.getDate()} 日`} · 今日菜单
            </AppText>
            {editing ? (
              <GhostButton label="清空" onPress={clearSelectedDay} icon={<TrashIcon size={13} />} />
            ) : (
              <AppText size={11} color={colors.muted}>
                {Object.keys(dayPlan).length} / 3 餐已安排
              </AppText>
            )}
          </View>

          {mealSlots.map((slot) => {
            const recipe = recipeFor(dayPlan, slot);
            const isSource = dragging?.dateKey === selectedDate && dragging.slot === slot;
            const crossDay = !!dragging && dragTarget?.date && dragTarget.date !== selectedDate;
            const swapInto =
              !!dragging &&
              dragging.slot !== slot &&
              dragTarget?.date === selectedDate &&
              dragTarget.slot === slot;
            const dayTarget = dragTarget?.date === selectedDate && dragTarget.slot === slot;

            if (!recipe) {
              return (
                <View
                  key={slot}
                  ref={(node) => {
                    rowRefs.current[slot] = node;
                  }}
                  onLayout={measureDays}
                >
                  {swapInto ? (
                    <View style={[styles.mealSwap, dayTarget && styles.mealSwapActive]}>
                      <AppText size={13} weight="600" color={colors.green}>
                        {dragging!.slot} → {slot}
                      </AppText>
                      <AppText size={10} color={colors.muted} style={{ marginTop: 3 }}>
                        松手后这里交换
                      </AppText>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => openPicker(selectedDate, slot)}
                      style={[styles.emptySlot, editing && { borderColor: "#DDE3CC" }]}
                      accessibilityLabel={`添加${slot}`}
                    >
                      <View style={styles.slotTag}>
                        <AppText size={10} color={colors.muted}>{slot}</AppText>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <PlusIcon size={13} color={colors.orange} />
                        <AppText size={13} color={colors.muted}>从菜谱库添加</AppText>
                      </View>
                    </Pressable>
                  )}
                </View>
              );
            }
            const actions = editing ? (
              <View style={styles.actions}>
                <Pressable onPress={() => openPicker(selectedDate, slot)} hitSlop={6} style={styles.actionBtn} accessibilityLabel="替换菜谱">
                  <SwapIcon size={12} />
                  <AppText size={11} color={colors.green}>替换</AppText>
                </Pressable>
                <Pressable onPress={() => moveMeal(selectedDate, slot, -1)} hitSlop={6} style={styles.actionBtn} accessibilityLabel="挪到前一天">
                  <AppText size={11} color={colors.green}>← 前一天</AppText>
                </Pressable>
                <Pressable onPress={() => moveMeal(selectedDate, slot, 1)} hitSlop={6} style={styles.actionBtn} accessibilityLabel="挪到后一天">
                  <AppText size={11} color={colors.green}>后一天 →</AppText>
                </Pressable>
                <Pressable onPress={() => editMeal(selectedDate, slot, null)} hitSlop={6} style={styles.actionBtn} accessibilityLabel="删除这一餐">
                  <TrashIcon size={12} />
                </Pressable>
              </View>
            ) : null;
            const content = (
              <Pressable
                style={[styles.meal, editing && styles.mealEditing]}
                onPress={() => (editing ? openPicker(selectedDate, slot) : router.push(`/recipe/${recipe.id}`))}
              >
                <View style={styles.mealBody}>
                  <View style={[styles.mealArt, recipe.art === "salad" && { backgroundColor: "#EDF0DF" }]}>
                    <FoodArt kind={recipe.art} size={52} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Pressable
                      onPress={() => (editing ? setSlotMenu({ dateKey: selectedDate, slot }) : undefined)}
                      hitSlop={8}
                      accessibilityRole={editing ? "button" : undefined}
                      accessibilityLabel={editing ? `把${slot}移到其他餐次` : undefined}
                    >
                      <View style={styles.slotTag}>
                        <AppText size={10} color={colors.muted}>
                          {slot}{editing ? " ⌄" : ""}
                        </AppText>
                      </View>
                    </Pressable>
                    <AppText size={14} weight="700" style={{ marginTop: 2 }}>
                      {recipe.name}
                    </AppText>
                    <AppText size={11} color={colors.muted} style={{ marginTop: 3 }}>
                      {recipe.minutes} 分钟 · {recipe.tags[0]} · {recipe.calories} 千卡
                    </AppText>
                  </View>
                </View>
                {actions}
              </Pressable>
            );
            const placeholder = (
              <View
                style={styles.mealPlaceholder}
                accessibilityLabel={
                  crossDay ? `${slot}已移到${weekdayOf(dragTarget!.date!)}` : `${slot}拖拽占位`
                }
              >
                {crossDay ? (
                  <>
                    <AppText size={12} color={colors.muted}>
                      {slot}已移到{weekdayOf(dragTarget!.date!)}
                    </AppText>
                    <AppText size={10} color={colors.muted} style={{ marginTop: 3 }}>
                      {view[dragTarget!.date!]?.[slot] ? "目标餐位已有菜，松手后交换" : "松手后生效"}
                    </AppText>
                  </>
                ) : (
                  <AppText size={11} color={colors.muted}>
                    拖动中 · 松手放到目标餐位
                  </AppText>
                )}
              </View>
            );
            return (
              <View
                key={slot}
                ref={(node) => {
                  rowRefs.current[slot] = node;
                }}
                onLayout={measureDays}
                style={isSource ? styles.rowDragging : undefined}
              >
                {swapInto ? (
                  <View style={[styles.mealSwap, dayTarget && styles.mealSwapActive]}>
                    <AppText size={13} weight="600" color={colors.green}>
                      {dragging!.slot} → {slot}
                    </AppText>
                    <AppText size={10} color={colors.muted} style={{ marginTop: 3 }}>
                      松手后这里交换
                    </AppText>
                  </View>
                ) : (
                  <DraggableMeal
                    enabled={editing}
                    placeholder={placeholder}
                    onLift={() => {
                      measureDays();
                      setDragging({ dateKey: selectedDate, slot });
                      setTarget({ date: selectedDate, slot: null });
                    }}
                    onMove={(pageX, pageY) => {
                      const date = dayAt(pageX);
                      if (!date) return setTarget(null);
                      if (date === selectedDate) {
                        const row = rowAt(pageY);
                        setTarget(row ? { date, slot: row } : { date, slot: null });
                      } else {
                        setTarget({ date, slot });
                      }
                    }}
                    onDrop={(pageX, pageY) => {
                      const current = dragTargetRef.current;
                      const date = current?.date ?? (pageX >= 0 ? dayAt(pageX) : null);
                      if (date) {
                        const toSlot = date === selectedDate ? rowAt(pageY) : slot;
                        if (toSlot) moveMealTo(selectedDate, slot, date, toSlot);
                      }
                      measureDays();
                      setDragging(null);
                      setTarget(null);
                    }}
                  >
                    {content}
                  </DraggableMeal>
                )}
              </View>
            );
          })}
        </View>

        <Pressable
          style={styles.shoppingEntry}
          onPress={() => router.push("/shopping-list")}
          accessibilityRole="button"
          accessibilityLabel={`打开${listTitle}`}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={styles.shoppingIcon}>
              <AppText size={13}>🧺</AppText>
            </View>
            <View>
              <AppText size={14} weight="700" color={colors.green}>
                {listTitle}
              </AppText>
              <AppText size={11} color={colors.muted} style={{ marginTop: 2 }}>
                已合并同类食材 · {shoppingItems.length} 项
              </AppText>
            </View>
          </View>
          <AppText size={16} color={colors.green}>→</AppText>
        </Pressable>

        {editing ? null : (
        <View style={styles.section}>
          <AppText size={12} color={colors.muted} style={{ marginBottom: spacing.sm }}>
            换个口味？
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {recipes.slice(1, 5).map((recipe) => (
              <Pressable
                key={recipe.id}
                onPress={() => router.push(`/recipe/${recipe.id}`)}
                style={styles.suggestion}
              >
                <FoodArt kind={recipe.art} size={54} />
                <AppText size={11} weight="600" numberOfLines={1} style={{ marginTop: 6, maxWidth: 66 }}>
                  {recipe.name}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        )}
      </ScrollView>

      {editing ? (
        <View style={[styles.editBar, { paddingBottom: spacing.lg }]}>
          <Pressable onPress={cancelEdit} style={styles.cancelBtn} accessibilityLabel="取消编辑">
            <AppText size={14} weight="600" color={colors.muted}>取消</AppText>
          </Pressable>
          <Pressable onPress={saveEdit} style={styles.saveBtn} accessibilityLabel="保存菜单">
            <AppText size={14} weight="700" color={colors.cream}>
              {dirty ? "保存菜单" : "完成"}
            </AppText>
          </Pressable>
        </View>
      ) : null}

      {toast ? (
        <View style={[styles.toast, { bottom: 96 }]}>
          <AppText size={12} weight="600" color={colors.cream}>{toast}</AppText>
        </View>
      ) : null}

      {slotMenu ? (
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSlotMenu(null)} accessibilityLabel="关闭餐次菜单" />
          <View style={[styles.sheet, { paddingBottom: spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <AppText size={16} weight="800">
              移到
            </AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 3, marginBottom: spacing.md }}>
              同样只写入草稿，保存后才生效
            </AppText>
            {mealSlots.map((target) => {
              const current = view[slotMenu.dateKey]?.[target];
              const isSource = target === slotMenu.slot;
              return (
                <Pressable
                  key={target}
                  onPress={() => {
                    moveMealTo(slotMenu.dateKey, slotMenu.slot, slotMenu.dateKey, target);
                    setSlotMenu(null);
                  }}
                  disabled={isSource}
                  style={[styles.slotMenuRow, isSource && { opacity: 0.45 }]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isSource, selected: isSource }}
                >
                  <AppText size={14} weight="600" color={isSource ? colors.muted : colors.ink}>
                    {target}
                  </AppText>
                  <AppText size={11} color={colors.muted}>
                    {isSource ? "当前位置" : current ? "交换" : "移到这里"}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {sheet ? (
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheet(null)} accessibilityLabel="关闭选择器" />
          <View style={[styles.sheet, { paddingBottom: spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <AppText size={16} weight="800">
              选择{sheet.slot}
            </AppText>
            <AppText size={11} color={colors.muted} style={{ marginTop: 3, marginBottom: spacing.md }}>
              {parseKey(sheet.dateKey).getMonth() + 1} 月 {parseKey(sheet.dateKey).getDate()} 日
            </AppText>
            <ScrollView style={{ maxHeight: 330 }} showsVerticalScrollIndicator={false}>
              {recipes.map((recipe) => {
                const picked = plan[sheet.dateKey]?.[sheet.slot] === recipe.id;
                const favored = favorites.includes(recipe.id);
                return (
                  <View key={recipe.id} style={styles.sheetRow}>
                    <Pressable style={styles.sheetPick} onPress={() => choose(recipe.id)}>
                      <FoodArt kind={recipe.art} size={40} />
                      <View style={{ flex: 1 }}>
                        <AppText size={13} weight="600">{recipe.name}</AppText>
                        <AppText size={11} color={colors.muted} style={{ marginTop: 2 }}>
                          {recipe.minutes} 分钟 · {recipe.calories} 千卡
                        </AppText>
                      </View>
                      {picked ? (
                        <View style={styles.picked}>
                          <AppText size={10} weight="600" color={colors.green}>当前</AppText>
                        </View>
                      ) : null}
                    </Pressable>
                    <Pressable onPress={() => toggleFavorite(recipe.id)} hitSlop={8} accessibilityLabel="收藏">
                      <AppText size={13} color={favored ? colors.orange : colors.muted}>{favored ? "♥" : "♡"}</AppText>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => {
                editMeal(sheet.dateKey, sheet.slot, null);
                setSheet(null);
              }}
              style={styles.clearRow}
            >
              <AppText size={13} color={colors.orangeText}>清空这一餐</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.run();
            setConfirm(null);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  emptyWeek: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: "#DDE3CC",
  },
  emptyWeekCta: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.orangeText,
    alignItems: "center",
    justifyContent: "center",
  },
  hintBar: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    backgroundColor: colors.greenSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  mealEditing: { borderColor: "#DDE3CC", borderWidth: 1.5, borderStyle: "dashed" },
  rowDragging: { zIndex: 40, elevation: 14 },
  mealPlaceholder: {
    flex: 1,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#DDE3CC",
    borderRadius: radius.lg,
    padding: spacing.md,
    justifyContent: "center",
    backgroundColor: "#F7F7F0",
  },
  mealSwap: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.orange,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    minHeight: 96,
    justifyContent: "center",
    backgroundColor: "#FBEce5",
  },
  mealSwapActive: { borderWidth: 2 },
  dayDropTarget: { backgroundColor: "#FBEce5", borderWidth: 1.5, borderColor: colors.orange },
  dayDropTargetActive: { borderWidth: 2, borderColor: colors.orange },
  mealTarget: { borderColor: colors.orange, borderWidth: 2, backgroundColor: "#FBEce5" },
  emptyTarget: { borderStyle: "solid", borderWidth: 2, backgroundColor: "#FBEce5" },
  slotMenuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  editBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.cream,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtn: {
    flex: 2,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: colors.green,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  header: { paddingHorizontal: spacing.xl },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  weekNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  days: { flexDirection: "row", gap: 6, marginTop: spacing.md },
  day: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: radius.md,
    backgroundColor: "#F2F3EA",
  },
  dayActive: { backgroundColor: colors.green },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 5 },
  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xxl },
  dayTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  mealBody: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  meal: {
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  mealArt: {
    width: 66,
    height: 66,
    borderRadius: radius.md,
    backgroundColor: "#F6E9D6",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  slotTag: {
    alignSelf: "flex-start",
    backgroundColor: "#F2F3EA",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, paddingLeft: 0 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.greenSoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  emptySlot: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#D8DCC9",
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 66,
  },
  shoppingEntry: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.greenSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shoppingIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestion: {
    width: 78,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#F8F6EF",
  },
  sheetBackdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(28,34,24,0.32)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: 34,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E0E2D5",
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 6,
  },
  sheetPick: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  picked: {
    backgroundColor: colors.greenSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  clearRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    alignItems: "center",
  },
});
