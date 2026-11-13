import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { LayoutAnimation } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../components/Common";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CloseIcon, SparkleIcon, TrashIcon } from "../components/Icons";
import { ImportRecipePane } from "../components/ImportRecipeSheet";
import { Toast, useToast } from "../components/Toast";
import { PressScale, SegmentedTabs } from "../components/create/Controls";
import { CameraIcon, ImageIcon } from "../components/create/CreateIcons";
import { Field, IS_ANDROID, Label, MinutesStepper, Typing } from "../components/create/Field";
import { AddLine, IngredientDraft, IngredientRow, StepDraft, StepRow } from "../components/create/RowEditors";
import type { ImportedDraft } from "../lib/importRecipe";
import { cookingIngredients, seasoningIngredients } from "../data/recipes";
import { useStore } from "../state/store";
import { colors, motion, radius, spacing } from "../theme";
import { importedPhoto, newImageId, pickFromLibrary, takePhoto, videoFrame } from "../lib/pickPhoto";
import type { StepImage } from "../lib/steps";
import { useMediaUris } from "../lib/useMedia";

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
  cover?: StepImage | null;
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
    draft.cover?.id ?? "",
  ]);

const sameDraft = (a: Parameters<typeof draftSignature>[0], b: Parameters<typeof draftSignature>[0]) =>
  draftSignature(a) === draftSignature(b);

const NAME_ERROR = "先给这道菜起个名字";
/** 打字机：相邻两个字段错开的毫秒数，以及最晚开始的时间（长菜谱不至于等太久）。 */
const TYPE_STAGGER = 110;
const TYPE_MAX_DELAY = 2200;

type Pane = "import" | "manual";
const PANES: { key: Pane; label: string }[] = [
  { key: "import", label: "链接 / 截图导入" },
  { key: "manual", label: "手动填写" },
];

/** 成品图落位：设计稿的 plateIn——带一点旋转从小放大，像一盘菜被端上桌。 */
const plateIn = (): LayoutAnimation => {
  "worklet";
  return {
    initialValues: {
      opacity: 0,
      transform: [{ rotate: "-10deg" }, { scale: 0.7 }],
    },
    animations: {
      opacity: withTiming(1, { duration: 260 }),
      transform: [
        { rotate: withTiming("0deg", { duration: 700, easing: Easing.out(Easing.cubic) }) },
        { scale: withSpring(1, motion.spring) },
      ],
    },
  };
};

/**
 * 自己录一道菜：顶部分段控件切「链接 / 截图导入」和「手动填写」，导入的结果会回填到手动表单。
 * 带 `?id=` 进来就是编辑——只有自建菜能编辑，内置/他人菜谱在这里直接被挡回。
 */
export default function CreateRecipeScreen() {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { createRecipe, updateRecipe, deleteRecipe, findRecipe } = useStore();
  const { toast, showText, undo } = useToast();
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
      cover: editing.cover ?? null,
    };
  }, [editable, editing]);

  const [name, setName] = useState(initial?.name ?? "");
  const [minutes, setMinutes] = useState(initial?.minutes ?? "");
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(initial?.ingredients ?? [emptyIngredient()]);
  const [seasonings, setSeasonings] = useState<IngredientDraft[]>(initial?.seasonings ?? [emptyIngredient()]);
  const [steps, setSteps] = useState<StepDraft[]>(initial?.steps ?? [emptyStep()]);
  const [cover, setCover] = useState<StepImage | null>(initial?.cover ?? null);
  const [picking, setPicking] = useState(false);
  // 深链进来时 store 可能还没从本地 blob 水合完，`editable` 会晚一帧才有值；
  // 编辑数据到位的那一刻补一次预填，否则表单是空的、一保存就把原菜洗白。
  const [hydratedId, setHydratedId] = useState<string | null>(initial ? editing?.id ?? null : null);
  if (initial && editing && hydratedId !== editing.id) {
    // 渲染期按 props 调整 state（React 官方推荐做法），不放进 effect，避免多渲染一轮空表单。
    setHydratedId(editing.id);
    setName(initial.name);
    setMinutes(initial.minutes);
    setIngredients(initial.ingredients);
    setSeasonings(initial.seasonings);
    setSteps(initial.steps);
    setCover(initial.cover ?? null);
  }
  const [error, setError] = useState<string | null>(null);
  const [nameShake, setNameShake] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 上移/下移之后要把焦点带回刚动过的那一步，用户连按两次不用重新点输入框。
  const stepInputs = useRef<Record<string, React.ComponentRef<typeof TextInput> | null>>({});
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [touched, setTouched] = useState(false);
  const [pane, setPane] = useState<Pane>("import");
  const [importBusy, setImportBusy] = useState(false);
  // 哪些字段是 AI 整理出来的——只影响标签上的小标，用户改过也照样留着提醒核对。
  const [aiFilled, setAiFilled] = useState<Record<string, boolean>>({});
  // 打字机回填：每次导入 run +1；order 记每个字段（菜名 / 行 key）排第几个出场。纯展示，不碰表单值。
  const [typeRun, setTypeRun] = useState<{ run: number; order: Record<string, number> } | null>(null);

  // 编辑模式没有导入入口，固定在手动表单。
  const activePane: Pane = editable ? "manual" : pane;
  const paneIn = useSharedValue(1);
  const paneStyle = useAnimatedStyle(() => ({
    opacity: paneIn.value,
    transform: [{ translateY: (1 - paneIn.value) * 18 }],
  }));

  const switchPane = (next: Pane) => {
    if (next === activePane) return;
    setPane(next);
    paneIn.set(0);
    paneIn.set(withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) }));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const typingFor = (key: string, offset = 0): Typing | null => {
    if (!typeRun || !(key in typeRun.order)) return null;
    return { run: typeRun.run, delay: Math.min(typeRun.order[key] * TYPE_STAGGER, TYPE_MAX_DELAY) + offset };
  };

  // 「和打开时不一样」才算脏：编辑模式刚打开什么都没改，不该弹确认。
  const dirty = touched
    ? true
    : !sameDraft(
        { name, minutes, ingredients, seasonings, steps, cover },
        {
          name: initial?.name ?? "",
          minutes: initial?.minutes ?? "",
          ingredients: initial?.ingredients ?? [],
          seasonings: initial?.seasonings ?? [],
          steps: initial?.steps ?? [],
          cover: initial?.cover ?? null,
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
    Haptics.selectionAsync().catch(() => {});
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

  const mediaUris = useMediaUris(editing?.id, [cover, ...steps.flatMap((row) => row.images ?? [])]);
  const coverUri = cover ? cover.localUri ?? mediaUris[cover.id] : undefined;

  /** 选图：本机临时文件先挂着 `localUri` 预览，保存时由 store 搬进缓存目录。 */
  const attach = async (target: "cover" | string, from: "library" | "camera") => {
    if (picking) return;
    const images = target === "cover" ? (cover ? 1 : 0) : steps.find((row) => row.key === target)?.images?.length ?? 0;
    if (images >= 9) {
      setError("每一步最多 9 张图");
      return;
    }
    // 换封面不增加总量；新加才挡。一道菜几百兆会拖垮 outbox。
    const addingNew = target === "cover" ? !cover : true;
    const total = (cover ? 1 : 0) + steps.reduce((sum, row) => sum + (row.images?.length ?? 0), 0);
    if (addingNew && total >= 40) {
      setError("一道菜最多 40 张图");
      return;
    }
    setPicking(true);
    setError(null);
    try {
      const picked = from === "camera" ? await takePhoto() : await pickFromLibrary();
      if (!picked) return;
      const id = newImageId();
      // 先用原图占位、立刻上屏；压图在后台完成后再把 localUri 换成压好的那份。
      const image: StepImage = {
        id,
        width: picked.preview.width,
        height: picked.preview.height,
        localUri: picked.preview.uri,
      };
      setTouched(true);
      if (target === "cover") setCover(image);
      else
        setSteps((current) =>
          current.map((row) =>
            row.key === target ? { ...row, images: [...(row.images ?? []), image] } : row
          )
        );
      setPicking(false);
      void picked.ready
        .then((photo) => {
          const patch = (current: StepImage | null) =>
            current?.id === id
              ? { ...current, localUri: photo.uri, width: photo.width, height: photo.height }
              : current;
          if (target === "cover") setCover((current) => patch(current));
          setSteps((current) =>
            current.map((row) =>
              row.images?.some((item) => item.id === id)
                ? {
                    ...row,
                    images: row.images.map((item) =>
                      item.id === id
                        ? { ...item, localUri: photo.uri, width: photo.width, height: photo.height }
                        : item
                    ),
                  }
                : row
            )
          );
        })
        .catch(() => {
          // 压缩失败就继续用原图：桶那边 5MB 才会拒，别让用户白选一次。
        });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "选图失败，再试一次");
    } finally {
      setPicking(false);
    }
  };

  const removeImage = (target: "cover" | string, imageId: string) => {
    setTouched(true);
    if (target === "cover") setCover(null);
    else
      setSteps((current) =>
        current.map((row) =>
          row.key === target
            ? { ...row, images: (row.images ?? []).filter((image) => image.id !== imageId) }
            : row
        )
      );
  };

  /**
   * AI 挑出来的成品图 / 步骤图：下载、压缩完一张挂一张，文字先上屏不等图。
   * 已经有封面就不换（可能是用户自己选的）；步骤是刚生成的，按 key 挂上去。
   */
  const attachDraftImages = (
    coverUri: string | undefined,
    stepUris: { key: string; uris: string[]; videoAt?: number | null }[],
    videoUrl?: string | null
  ) => {
    const toImage = async (uri: string): Promise<StepImage | null> => {
      const photo = await importedPhoto(uri);
      return photo ? { id: newImageId(), localUri: photo.uri, width: photo.width, height: photo.height } : null;
    };
    if (coverUri && !cover) {
      void toImage(coverUri).then((image) => {
        if (image) setCover((current) => current ?? image);
      });
    }
    for (const { key, uris } of stepUris) {
      if (!uris.length) continue;
      void Promise.all(uris.map(toImage)).then((list) => {
        const images = list.filter((image): image is StepImage => Boolean(image));
        if (!images.length) return;
        setSteps((current) =>
          current.map((row) => (row.key === key ? { ...row, images: [...(row.images ?? []), ...images] } : row))
        );
      });
    }
    // 视频笔记：没配到图的步骤按 AI 标的秒数截帧。一张一张来，同时截好几帧低端机会卡。
    const frames = videoUrl
      ? stepUris.filter((item) => !item.uris.length && typeof item.videoAt === "number")
      : [];
    if (!videoUrl || !frames.length) return;
    void (async () => {
      for (const { key, videoAt } of frames) {
        const photo = await videoFrame(videoUrl, videoAt as number);
        if (!photo) continue;
        const image: StepImage = { id: newImageId(), localUri: photo.uri, width: photo.width, height: photo.height };
        setSteps((current) =>
          current.map((row) => (row.key === key ? { ...row, images: [...(row.images ?? []), image] } : row))
        );
      }
    })();
  };

  /** AI 草稿回填表单：一律当草稿，不改 touched 语义，保存前用户仍然要自己点确认。 */
  const applyDraft = (draft: ImportedDraft) => {
    setTouched(true);
    setError(null);
    const nextIngredients = toDrafts(draft.ingredients);
    const nextSeasonings = toDrafts(draft.seasonings);
    const nextSteps = draft.steps.length ? draft.steps.map((step) => ({ key: nextKey(), text: step.text })) : [emptyStep()];
    attachDraftImages(
      draft.coverUri,
      draft.steps.map((step, index) => ({ key: nextSteps[index].key, uris: step.imageUris ?? [], videoAt: step.videoAt })),
      draft.videoUrl
    );
    if (draft.name) setName(draft.name);
    if (draft.minutes) setMinutes(`${draft.minutes}`);
    setIngredients(nextIngredients);
    setSeasonings(nextSeasonings);
    setSteps(nextSteps);
    setAiFilled({
      ...(draft.name ? { name: true } : {}),
      ...(draft.minutes ? { minutes: true } : {}),
      ...(draft.ingredients.length ? { ingredients: true } : {}),
      ...(draft.seasonings.length ? { seasonings: true } : {}),
      ...(draft.steps.length ? { steps: true } : {}),
    });
    // 打字机只是表演：值已经全部写进 state，减少动态效果时直接跳过。
    if (!reducedMotion) {
      const order: Record<string, number> = {};
      let n = 0;
      if (draft.name) order.name = n++;
      if (draft.minutes) order.minutes = n++;
      for (const row of [...nextIngredients, ...nextSeasonings, ...nextSteps]) order[row.key] = n++;
      setTypeRun((current) => ({ run: (current?.run ?? 0) + 1, order }));
    }
    switchPane("manual");
    const stepImageCount = draft.steps.reduce((sum, step) => sum + (step.imageUris?.length ?? 0), 0);
    const frameCount = draft.videoUrl
      ? draft.steps.filter((step) => !step.imageUris?.length && typeof step.videoAt === "number").length
      : 0;
    const picked = [draft.coverUri ? "成品图" : "", stepImageCount ? `${stepImageCount} 张步骤图` : ""].filter(Boolean);
    showText(
      frameCount
        ? `解析好了，正在截取 ${frameCount} 张步骤图`
        : picked.length
          ? `解析好了，配上了${picked.join("和")}`
          : "解析好了，核对后保存"
    );
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(NAME_ERROR);
      setNameShake((n) => n + 1);
      if (activePane !== "manual") switchPane("manual");
      else scrollRef.current?.scrollTo({ y: 0, animated: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    const fail = (message: string) => {
      setError(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    };
    const parsedIngredients = parseRows(ingredients);
    const parsedSeasonings = parseRows(seasonings);
    if (!parsedIngredients.length && !parsedSeasonings.length) {
      fail("至少填一样食材或调料");
      return;
    }
    const allRows = [...parsedIngredients, ...parsedSeasonings];
    if (allRows.some((item) => item.qty !== null && !Number.isFinite(item.qty))) {
      fail("数量只能填数字");
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
      cover,
    };

    const recipe = editable && editing ? updateRecipe(editing.id, input) : createRecipe(input);
    if (!recipe) {
      fail("保存失败，检查一下菜名和食材");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // 深链直接进来的（没有上一页）退回详情，别把用户留在已经保存过的表单上。
    if (router.canGoBack()) router.back();
    else router.replace(`/recipe/${recipe.id}`);
  };

  if (id && !editable) {
    return (
      <View style={[styles.screen, styles.blocked, { paddingTop: insets.top + 48 }]}>
        <View style={styles.blockedBadge}>
          <SparkleIcon size={26} color={colors.sunText} />
        </View>
        <AppText size={20} weight="800" style={{ marginTop: spacing.lg }}>这道菜不能编辑</AppText>
        <AppText size={14} color={colors.muted} style={{ marginTop: spacing.sm, lineHeight: 21 }}>
          只能编辑自己建的菜谱
        </AppText>
        <PressScale onPress={leaveNow} style={[styles.darkBtn, { marginTop: spacing.xxl }]} accessibilityRole="button">
          <AppText size={16} weight="700" color={colors.white}>返回</AppText>
        </PressScale>
      </View>
    );
  }

  const canSave = name.trim().length > 0;
  const nameError = error === NAME_ERROR;
  const bannerError = error && !nameError ? error : null;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.topbar, { paddingTop: insets.top + 6 }]}>
        <PressScale
          onPress={leave}
          scaleTo={0.88}
          hitSlop={4}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="关闭"
        >
          <CloseIcon size={22} color={colors.ink} />
        </PressScale>
        <AppText size={IS_ANDROID ? 20 : 17} weight={IS_ANDROID ? "600" : "700"} style={styles.title} numberOfLines={1}>
          {editable ? "编辑菜谱" : "新建菜谱"}
        </AppText>
        {picking ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        <Pressable
          onPress={save}
          hitSlop={6}
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={editable ? "保存修改" : "保存这道菜"}
        >
          <AppText size={16} weight="700" color={colors.accentText} style={{ opacity: canSave ? 1 : 0.35 }}>
            保存
          </AppText>
        </Pressable>
      </View>

      {!editable ? (
        <View style={styles.segWrap}>
          <SegmentedTabs options={PANES} value={activePane} onChange={switchPane} disabled={importBusy} />
        </View>
      ) : null}

      {bannerError ? (
        <Animated.View entering={FadeInDown.duration(motion.duration.base)} exiting={FadeOutUp.duration(motion.duration.fast)} style={styles.banner}>
          <AppText size={13} weight="600" color={colors.accentText} style={{ flex: 1, lineHeight: 19 }}>
            {bannerError}
          </AppText>
          <Pressable onPress={() => setError(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="关闭提示">
            <CloseIcon size={16} color={colors.accentText} />
          </Pressable>
        </Animated.View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!editable ? (
          <Animated.View style={[styles.pane, activePane !== "import" && styles.hidden, paneStyle]}>
            <ImportRecipePane
              onDraft={applyDraft}
              onBusyChange={setImportBusy}
              onManual={() => {
                setTouched(true);
                switchPane("manual");
              }}
            />
          </Animated.View>
        ) : null}

        <Animated.View style={[styles.pane, activePane !== "manual" && styles.hidden, paneStyle]}>
          {Object.keys(aiFilled).length > 0 ? (
            <Animated.View entering={FadeInDown.duration(motion.duration.slow)} style={styles.aiNote}>
              <SparkleIcon size={18} color={colors.sunText} />
              <AppText size={13} color={colors.sunText} style={{ flex: 1, lineHeight: 19 }}>
                AI 整理，请核对用量
              </AppText>
            </Animated.View>
          ) : null}

          {coverUri ? (
            <View style={styles.coverWrap}>
              <Animated.View key={cover?.id} entering={plateIn} style={styles.coverPhoto}>
                <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} resizeMode="cover" alt="成品图" />
              </Animated.View>
              <Pressable
                onPress={() => removeImage("cover", cover?.id ?? "")}
                hitSlop={8}
                style={styles.coverRemove}
                accessibilityRole="button"
                accessibilityLabel="删掉成品图"
              >
                <CloseIcon size={16} color={colors.ink} />
              </Pressable>
            </View>
          ) : (
            <PressScale
              onPress={() => attach("cover", "library")}
              scaleTo={0.98}
              style={styles.coverEmpty}
              accessibilityRole="button"
              accessibilityLabel="添加成品图"
            >
              <ImageIcon size={28} color={colors.muted} />
              <AppText size={14} weight="600" color={colors.muted}>添加成品图</AppText>
            </PressScale>
          )}
          <View style={styles.coverActions}>
            <PressScale
              onPress={() => attach("cover", "camera")}
              style={styles.softChip}
              accessibilityRole="button"
              accessibilityLabel="拍一张成品图"
            >
              <CameraIcon size={16} color={colors.ink} />
              <AppText size={13} weight="600">拍照</AppText>
            </PressScale>
            <PressScale
              onPress={() => attach("cover", "library")}
              style={styles.softChip}
              accessibilityRole="button"
              accessibilityLabel={cover ? "从相册换一张成品图" : "从相册选成品图"}
            >
              <ImageIcon size={16} color={colors.ink} />
              <AppText size={13} weight="600">{cover ? "换一张" : "从相册选"}</AppText>
            </PressScale>
          </View>

          <View style={styles.group}>
            <Label ai={aiFilled.name}>菜名</Label>
            <Field
              value={name}
              onChangeText={(value) => {
                setTouched(true);
                setName(value);
                setError(null);
              }}
              placeholder="比如：蒜香西兰花炒虾仁"
              returnKeyType="done"
              typing={typingFor("name")}
              error={nameError}
              shake={nameShake}
              accessibilityLabel="菜名"
            />
            {nameError ? (
              <Animated.View entering={FadeInDown.duration(motion.duration.base)}>
                <AppText size={13} color={colors.danger} style={{ marginTop: 6 }}>{NAME_ERROR}</AppText>
              </Animated.View>
            ) : null}
          </View>

          <View style={styles.group}>
            <Label hint="可不填" ai={aiFilled.minutes}>大概用时</Label>
            <MinutesStepper
              value={minutes}
              flashRun={typingFor("minutes")?.run ?? 0}
              onChange={(value) => {
                setTouched(true);
                setMinutes(value);
              }}
            />
          </View>

          <View style={styles.group}>
            <Label hint="会进采购清单" ai={aiFilled.ingredients}>食材</Label>
            {ingredients.map((item) => (
              <IngredientRow
                key={item.key}
                item={item}
                namePlaceholder="食材"
                removeLabel="删除这样食材"
                typing={(offset) => typingFor(item.key, offset)}
                onChange={(patch) => updateRow(setIngredients, item.key, patch)}
                onRemove={() =>
                  setIngredients((current) =>
                    current.length > 1 ? current.filter((row) => row.key !== item.key) : current
                  )
                }
              />
            ))}
            <AddLine
              label="添加食材"
              accessibilityLabel="添加一样食材"
              onPress={() => {
                setTouched(true);
                setIngredients((current) => [...current, emptyIngredient()]);
              }}
            />
            <AppText size={12} color={colors.muted} style={styles.footnote}>
              数量留空即「适量」
            </AppText>
          </View>

          <View style={styles.group}>
            <Label hint="不进采购清单" ai={aiFilled.seasonings}>调料</Label>
            {seasonings.map((item) => (
              <IngredientRow
                key={item.key}
                item={item}
                namePlaceholder="调料"
                removeLabel="删除这样调料"
                typing={(offset) => typingFor(item.key, offset)}
                onChange={(patch) => updateRow(setSeasonings, item.key, patch)}
                onRemove={() =>
                  setSeasonings((current) =>
                    current.length > 1 ? current.filter((row) => row.key !== item.key) : current
                  )
                }
              />
            ))}
            <AddLine
              label="添加调料"
              accessibilityLabel="添加一样调料"
              onPress={() => {
                setTouched(true);
                setSeasonings((current) => [...current, emptyIngredient()]);
              }}
            />
          </View>

          <View style={styles.group}>
            <Label ai={aiFilled.steps}>步骤</Label>
            {steps.map((item, index) => (
              <StepRow
                key={item.key}
                item={item}
                index={index}
                count={steps.length}
                mediaUris={mediaUris}
                typing={typingFor(item.key)}
                inputRef={(node) => {
                  stepInputs.current[item.key] = node;
                }}
                onChangeText={(value) => {
                  setTouched(true);
                  setSteps((current) =>
                    current.map((row) => (row.key === item.key ? { ...row, text: value } : row))
                  );
                }}
                onMove={(delta) => moveStep(item.key, delta)}
                onRemove={() =>
                  setSteps((current) =>
                    current.length > 1 ? current.filter((row) => row.key !== item.key) : current
                  )
                }
                onAddImage={() => attach(item.key, "library")}
                onRemoveImage={(imageId) => removeImage(item.key, imageId)}
              />
            ))}
            <AddLine
              label="添加步骤"
              accessibilityLabel="添加一步"
              onPress={() => {
                setTouched(true);
                setSteps((current) => [...current, emptyStep()]);
              }}
            />
          </View>
          {editable ? (
            <PressScale
              onPress={() => setConfirmDelete(true)}
              accessibilityLabel="删除这道菜"
              style={styles.deleteBtn}
            >
              <TrashIcon size={18} color={colors.danger} />
              <AppText size={15} weight="700" color={colors.danger}>
                删除这道菜
              </AppText>
            </PressScale>
          ) : null}
        </Animated.View>
      </ScrollView>

      <Toast toast={toast} bottom={insets.bottom + 24} onUndo={undo} />
      {confirmLeave ? (
        <ConfirmDialog
          title="这道菜还没保存"
          message="刚填的内容会丢失。"
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
      {confirmDelete && editing ? (
        <ConfirmDialog
          title={`删除「${editing.name}」？`}
          message="计划里的这道菜也会一起移除。"
          cancelLabel="留着"
          confirmLabel="删除"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            if (!deleteRecipe(editing.id)) {
              showText("只能删除自己创建的菜");
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            // 详情页还压在栈里，菜已经没了：直接回到首页。
            router.dismissTo("/");
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  blocked: { paddingHorizontal: spacing.xl },
  blockedBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.sunSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
    minHeight: 52,
  },
  iconBtn: {
    width: IS_ANDROID ? 48 : 44,
    height: IS_ANDROID ? 48 : 44,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, textAlign: IS_ANDROID ? "left" : "center", paddingLeft: IS_ANDROID ? 4 : 0 },
  saveBtn: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" },
  segWrap: { paddingHorizontal: spacing.xl, paddingTop: 4 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
  },
  pane: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  hidden: { display: "none" },
  aiNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.sunSoft,
    marginBottom: 18,
  },
  coverEmpty: {
    height: 168,
    borderRadius: IS_ANDROID ? 20 : radius.lg,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  coverWrap: { height: 200 },
  coverPhoto: {
    flex: 1,
    borderRadius: IS_ANDROID ? 20 : radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
  },
  coverRemove: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  coverActions: { flexDirection: "row", gap: spacing.sm, marginTop: 10, marginBottom: 22 },
  softChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: IS_ANDROID ? radius.pill : 12,
    backgroundColor: colors.surfaceAlt,
  },
  group: { marginBottom: 22 },
  footnote: { marginTop: 2, lineHeight: 18 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  darkBtn: {
    minHeight: 52,
    borderRadius: IS_ANDROID ? radius.pill : 16,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
});
