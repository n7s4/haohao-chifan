/**
 * 新建菜谱页的「一行食材」「一步做法」编辑行，纯展示：所有 state 和校验都在 create-recipe.tsx。
 * 新加的行从下面升上来（设计稿 `.ingrow` / `.steprow` 的 rise），删除和上下移动走布局过渡。
 */
import React from "react";
import { Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeInDown, FadeOut, LinearTransition, ZoomIn } from "react-native-reanimated";

import { AppText } from "../Common";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, PlusIcon, TrashIcon } from "../Icons";
import type { StepImage } from "../../lib/steps";
import { colors, motion, radius } from "../../theme";
import { PressScale } from "./Controls";
import { ImageIcon } from "./CreateIcons";
import { Field, Typing } from "./Field";

export type IngredientDraft = { key: string; name: string; qty: string; unit: string };
export type StepDraft = { key: string; text: string; images?: StepImage[] };

const rise = FadeInDown.duration(350);
const layout = LinearTransition.springify().damping(18).stiffness(180);

/** 「+ 添加食材」这种整行文字按钮，番茄红压字。 */
export function AddLine({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <PressScale
      onPress={onPress}
      style={styles.addLine}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <PlusIcon size={16} color={colors.accentText} />
      <AppText size={14.5} weight="700" color={colors.accentText}>{label}</AppText>
    </PressScale>
  );
}

function RemoveButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <PressScale
      onPress={onPress}
      scaleTo={0.85}
      hitSlop={4}
      style={styles.remove}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <TrashIcon size={18} color={colors.placeholder} />
    </PressScale>
  );
}

export function IngredientRow({
  item,
  namePlaceholder,
  removeLabel,
  typing,
  onChange,
  onRemove,
}: {
  item: IngredientDraft;
  namePlaceholder: string;
  removeLabel: string;
  /** 这一行三个格子的打字机参数；`offset` 让名称 → 数量 → 单位依次打出来。 */
  typing: (offset: number) => Typing | null;
  onChange: (patch: Partial<IngredientDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <Animated.View entering={rise} exiting={FadeOut.duration(motion.duration.fast)} layout={layout} style={styles.ingRow}>
      <Field
        value={item.name}
        onChangeText={(value) => onChange({ name: value })}
        placeholder={namePlaceholder}
        typing={typing(0)}
        style={[styles.cell, { flex: 1 }]}
        inputStyle={styles.cellInput}
        accessibilityLabel={`${namePlaceholder}名称`}
      />
      <Field
        value={item.qty}
        onChangeText={(value) => onChange({ qty: value })}
        placeholder="数量"
        keyboardType="decimal-pad"
        typing={typing(60)}
        style={[styles.cell, styles.cellQty]}
        inputStyle={[styles.cellInput, styles.cellCenter]}
        accessibilityLabel="数量"
      />
      <Field
        value={item.unit}
        onChangeText={(value) => onChange({ unit: value })}
        placeholder="单位"
        typing={typing(120)}
        style={[styles.cell, styles.cellUnit]}
        inputStyle={[styles.cellInput, styles.cellCenter]}
        accessibilityLabel="单位"
      />
      <RemoveButton onPress={onRemove} label={removeLabel} />
    </Animated.View>
  );
}

export function StepRow({
  item,
  index,
  count,
  mediaUris,
  typing,
  inputRef,
  onChangeText,
  onMove,
  onRemove,
  onAddImage,
  onRemoveImage,
}: {
  item: StepDraft;
  index: number;
  count: number;
  mediaUris: Record<string, string | undefined>;
  typing: Typing | null;
  inputRef: (node: React.ComponentRef<typeof TextInput> | null) => void;
  onChangeText: (value: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onAddImage: () => void;
  onRemoveImage: (imageId: string) => void;
}) {
  const images = item.images ?? [];
  const showThumbs = images.length > 0 || item.text.trim().length > 0;
  return (
    <Animated.View entering={rise} exiting={FadeOut.duration(motion.duration.fast)} layout={layout} style={styles.stepRow}>
      <View style={styles.stepNo}>
        <AppText size={14} weight="800" color={colors.sunText}>{index + 1}</AppText>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Field
          inputRef={inputRef}
          value={item.text}
          onChangeText={onChangeText}
          placeholder="这一步做什么？"
          multiline
          typing={typing}
          style={styles.stepField}
          inputStyle={styles.stepInput}
          accessibilityLabel={`第 ${index + 1} 步`}
        />
        {showThumbs ? (
          <View style={styles.thumbs}>
            {images.map((image) => {
              const uri = image.localUri ?? mediaUris[image.id];
              return (
                <Animated.View key={image.id} entering={ZoomIn.springify().damping(12)} style={styles.thumbWrap}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.thumb} resizeMode="cover" alt={`第 ${index + 1} 步配图`} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbEmpty]} />
                  )}
                  <Pressable
                    onPress={() => onRemoveImage(image.id)}
                    hitSlop={8}
                    style={styles.thumbRemove}
                    accessibilityRole="button"
                    accessibilityLabel="删掉这张步骤图"
                  >
                    <CloseIcon size={11} color={colors.white} />
                  </Pressable>
                </Animated.View>
              );
            })}
            {images.length < 9 ? (
              <PressScale
                onPress={onAddImage}
                style={styles.thumbAdd}
                accessibilityRole="button"
                accessibilityLabel={`给第 ${index + 1} 步加一张图`}
              >
                <ImageIcon size={18} color={colors.placeholder} />
                <AppText size={11} weight="600" color={colors.placeholder} style={{ marginTop: 2 }}>加图</AppText>
              </PressScale>
            ) : null}
          </View>
        ) : (
          <Pressable
            onPress={onAddImage}
            hitSlop={6}
            style={styles.addImageLink}
            accessibilityRole="button"
            accessibilityLabel={`给第 ${index + 1} 步加一张图`}
          >
            <ImageIcon size={15} color={colors.muted} />
            <AppText size={12} weight="600" color={colors.muted}>加图</AppText>
          </Pressable>
        )}
      </View>
      <View style={styles.stepSide}>
        <RemoveButton onPress={onRemove} label="删除这一步" />
        {count > 1 && index > 0 ? (
          <Pressable
            onPress={() => onMove(-1)}
            hitSlop={4}
            style={styles.order}
            accessibilityRole="button"
            accessibilityLabel={`上移第 ${index + 1} 步`}
          >
            <ChevronUpIcon size={15} color={colors.muted} />
          </Pressable>
        ) : null}
        {count > 1 && index < count - 1 ? (
          <Pressable
            onPress={() => onMove(1)}
            hitSlop={4}
            style={styles.order}
            accessibilityRole="button"
            accessibilityLabel={`下移第 ${index + 1} 步`}
          >
            <ChevronDownIcon size={15} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  addLine: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, alignSelf: "flex-start" },
  remove: { width: 40, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  cell: { minHeight: 48, paddingHorizontal: 12 },
  cellInput: { fontSize: 14.5, minHeight: 44 },
  cellCenter: { textAlign: "center" },
  cellQty: { width: 64, paddingHorizontal: 6 },
  cellUnit: { width: 60, paddingHorizontal: 6 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 10 },
  stepNo: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.sunSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 11,
  },
  stepField: { paddingHorizontal: 14 },
  stepInput: { minHeight: 76, fontSize: 15 },
  stepSide: { width: 40, alignItems: "center" },
  order: { width: 40, height: 30, alignItems: "center", justifyContent: "center" },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  thumbWrap: { width: 64, height: 64, borderRadius: radius.sm, overflow: "hidden" },
  thumb: { width: 64, height: 64, backgroundColor: colors.surfaceAlt },
  thumbEmpty: { borderWidth: 1, borderColor: colors.border },
  thumbRemove: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbAdd: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  addImageLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, alignSelf: "flex-start", minHeight: 28 },
});
