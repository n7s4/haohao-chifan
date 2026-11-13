/**
 * 好好吃饭 · 主题 token
 *
 * 2026-11 改版三（对应 ../app-redesign/app.css）：活泼 / 亲切 / 插画感。
 * 番茄红 = 开始 / 行动，叶子绿 = 完成，阳光黄 = 高亮，深绿灶台 = 做饭模式。
 * 语义键名沿用上一版，换色时不需要改调用处；新增的键见下方「新增」。
 * 色值由设计稿的 OKLch 换算成 sRGB hex。
 */
export const colors = {
  canvas: "#F7FBFB",
  surface: "#FFFFFF",
  /** 次级底：输入框、分段控件、软按钮。 */
  surfaceAlt: "#EEF4F6",
  border: "#E0E3E8",

  /** 主色：墨蓝。用于选中胶囊、深色按钮、图标、标题强调。 */
  primary: "#171F2E",
  /** 主色的浅底，压浅色块 / 未选中胶囊 / AI 面板底。 */
  primarySoft: "#EEF4F6",

  /** 番茄红：主要行动（开始做饭、加入计划、FAB）。色块用 accent，压字用 accentText。 */
  accent: "#F05133",
  accentText: "#C83314",
  accentSoft: "#FFE9E3",

  /** 叶子绿：完成 / 已买 / 健康。压字用 leafText。 */
  leaf: "#45B164",
  leafText: "#0A6D37",
  leafSoft: "#DEF8E2",

  /** 阳光黄：高亮、徽标、插画点缀。上面压字用 ink，不用白字。 */
  sun: "#FFC83A",
  sunSoft: "#FEF6D4",
  /** 阳光黄底上的压字（AI 按钮等）。 */
  sunText: "#7A5A00",

  /** 天空蓝：插画 / 信息提示的辅助色。 */
  sky: "#9CD3F1",
  skySoft: "#E4F5FE",

  /** 深色屏（做饭模式）：深绿灶台，压字用下面那组 onDeep*。 */
  deep: "#0E2D20",
  deepRaised: "#1B3D2D",
  deepLine: "#314F40",

  /** 成功态，和 leafText 同值。 */
  success: "#0A6D37",
  /** 删除等破坏性操作，比番茄红更深更冷，避免同屏分不清。 */
  danger: "#CC272E",

  ink: "#171F2E",
  muted: "#5C6470",
  placeholder: "#9399A2",
  disabled: "#B7BCC4",
  handle: "#D9DDE3",
  track: "#EEF4F6",
  white: "#FFFFFF",

  onDeepTitle: "#EDF4EE",
  onDeepBody: "#CFDBD1",
  onDeepSub: "#B1C4B4",
  onDeepHint: "#98AA9B",
  onDeepLabel: "#B1C4B4",
  onDeepTipBody: "#CFDBD1",
  onDeepAccent: "#FFAC8E",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
};

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  pill: 999,
};

/** 卡片用一层很轻的墨蓝投影托起，浮层（sheet / FAB）投影更重。 */
export const shadow = {
  card: {
    shadowColor: "#171F2E",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  floating: {
    shadowColor: "#171F2E",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
};

/** 动效：和设计稿的 --ease-out / --ease-spring 对应，给 Reanimated 用。 */
export const motion = {
  spring: { damping: 14, stiffness: 180, mass: 0.9 },
  springSoft: { damping: 20, stiffness: 140 },
  duration: { fast: 160, base: 240, slow: 420 },
};
