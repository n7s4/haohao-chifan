import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";

import { ArtKind } from "../data/recipes";
import { colors } from "../theme";

type Props = {
  kind?: ArtKind;
  size?: number;
  plate?: boolean;
  /** 没有插画时用菜名首字兜底；比按名字 hash 挑一张不相关的图准确。 */
  label?: string;
};

/** 设计稿 app.js 里的插画色（OKLch 换算成 hex），跟 theme 的番茄 / 叶子 / 阳光 / 天空同源。 */
const C = {
  tomato: colors.accent,
  tomatoDk: colors.accentText,
  leaf: colors.leaf,
  leafDk: "#1D7D3E",
  sun: colors.sun,
  sunDk: "#E8A127",
  cream: "#FAF5E6",
  sky: colors.sky,
  brown: "#885E41",
  toast: "#E1AC6E",
  crust: "#B6753B",
  orange: "#F28F29",
  avo: "#BFDF86",
  white: "#FFFFFF",
  shade: colors.ink,
};

/** 每道菜垫一块对应色系的浅底：番茄面 → 番茄浅、沙拉 → 叶子浅…… */
const PLATE: Record<ArtKind, string> = {
  pasta: colors.accentSoft,
  salad: colors.leafSoft,
  rice: colors.sunSoft,
  soup: colors.skySoft,
  toast: colors.sunSoft,
};

/** 碗：投影 + 碗身 + 高光 + 碗口，内容画在碗口上。 */
function Bowl({ color, rim, children }: { color: string; rim: string; children: React.ReactNode }) {
  return (
    <>
      <Ellipse cx={100} cy={166} rx={62} ry={8} fill={C.shade} fillOpacity={0.08} />
      <Path d="M28 104 Q30 166 100 166 Q170 166 172 104 Z" fill={color} />
      <Path
        d="M40 132 Q100 150 160 132"
        stroke={C.white}
        strokeOpacity={0.35}
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
      />
      <Ellipse cx={100} cy={104} rx={72} ry={18} fill={rim} />
      {children}
    </>
  );
}

function Pasta() {
  return (
    <Bowl color={C.sky} rim={C.sunDk}>
      <G stroke={C.sun} strokeWidth={6} fill="none" strokeLinecap="round">
        <Path d="M44 104c10-10 18 8 28-2s18 8 28-2 18 8 28-2 16 6 26 0" />
        <Path d="M52 96c10-8 16 6 26-2s18 6 28-2 18 6 26-2" />
        <Path d="M60 110c10-6 16 6 26 0s18 6 28 0 16 6 26 0" />
      </G>
      <Circle cx={78} cy={94} r={10} fill={C.tomato} />
      <Circle cx={75} cy={91} r={3} fill={C.white} opacity={0.5} />
      <Circle cx={120} cy={100} r={10} fill={C.tomato} />
      <Circle cx={117} cy={97} r={3} fill={C.white} opacity={0.5} />
      <Circle cx={100} cy={86} r={8} fill={C.tomatoDk} />
      <Ellipse cx={138} cy={90} rx={9} ry={5} fill={C.leaf} transform="rotate(-30 138 90)" />
      <Ellipse cx={62} cy={104} rx={8} ry={4.5} fill={C.leaf} transform="rotate(25 62 104)" />
    </Bowl>
  );
}

function Salad() {
  return (
    <Bowl color={C.white} rim={C.leafDk}>
      <Ellipse cx={62} cy={96} rx={20} ry={11} fill={C.leaf} transform="rotate(-20 62 96)" />
      <Ellipse cx={140} cy={96} rx={20} ry={11} fill={C.leaf} transform="rotate(20 140 96)" />
      <Path d="M84 104c0-16 14-24 22-20 6 3 4 12-2 18" fill={C.avo} stroke={C.leafDk} strokeWidth={4} />
      <Circle cx={98} cy={96} r={5} fill={C.brown} />
      <Ellipse cx={128} cy={86} rx={15} ry={11} fill={C.white} />
      <Circle cx={128} cy={86} r={6.5} fill={C.sun} />
      <G fill={C.cream}>
        <Circle cx={70} cy={110} r={2.5} />
        <Circle cx={114} cy={112} r={2.5} />
        <Circle cx={148} cy={108} r={2.5} />
        <Circle cx={56} cy={104} r={2.5} />
      </G>
      <Circle cx={80} cy={84} r={7} fill={C.tomato} />
    </Bowl>
  );
}

function Rice() {
  return (
    <Bowl color={C.tomato} rim={C.cream}>
      <Path d="M40 104c4-22 30-30 60-30s56 8 60 30z" fill={C.cream} />
      <Path d="M64 88a12 12 0 0 1 24 0z" fill={C.brown} />
      <Rect x={73} y={88} width={6} height={8} rx={2} fill={C.cream} stroke={C.brown} strokeWidth={1.5} />
      <Path d="M112 84a11 11 0 0 1 22 0z" fill={C.brown} />
      <Rect x={92} y={90} width={18} height={12} rx={5} fill={C.toast} />
      <Rect x={128} y={94} width={16} height={11} rx={5} fill={C.toast} />
      <G fill={C.orange}>
        <Rect x={56} y={98} width={7} height={7} rx={1.5} />
        <Rect x={118} y={100} width={7} height={7} rx={1.5} />
        <Rect x={100} y={78} width={7} height={7} rx={1.5} />
      </G>
      <G fill={C.leaf}>
        <Circle cx={86} cy={100} r={2.6} />
        <Circle cx={146} cy={88} r={2.6} />
        <Circle cx={68} cy={82} r={2.6} />
      </G>
    </Bowl>
  );
}

function Soup() {
  return (
    <Bowl color={C.leafDk} rim={C.orange}>
      <Ellipse cx={100} cy={104} rx={64} ry={14} fill={C.orange} />
      <Path d="M78 102c6-8 22-8 26 0s-12 10-6 4" stroke={C.cream} strokeWidth={5} fill="none" strokeLinecap="round" />
      <G fill={C.leafDk}>
        <Ellipse cx={124} cy={100} rx={4} ry={2.5} />
        <Ellipse cx={134} cy={106} rx={4} ry={2.5} transform="rotate(30 134 106)" />
        <Ellipse cx={116} cy={108} rx={4} ry={2.5} transform="rotate(-20 116 108)" />
      </G>
      <Ellipse cx={62} cy={104} rx={7} ry={3} fill={C.cream} opacity={0.7} />
    </Bowl>
  );
}

function Toast() {
  return (
    <>
      <Ellipse cx={100} cy={150} rx={78} ry={22} fill={C.shade} fillOpacity={0.07} />
      <Ellipse cx={100} cy={140} rx={80} ry={24} fill={C.white} />
      <Ellipse cx={100} cy={138} rx={62} ry={17} fill={C.sky} opacity={0.35} />
      <Rect x={44} y={70} width={80} height={70} rx={22} fill={C.crust} transform="rotate(-8 84 105)" />
      <Rect x={51} y={77} width={66} height={56} rx={17} fill={C.toast} transform="rotate(-8 84 105)" />
      <Path d="M62 98c-6-12 8-22 22-18 12-8 30 2 24 16 8 10-4 22-18 18-12 6-30-2-28-16z" fill={C.white} />
      <Circle cx={86} cy={102} r={11} fill={C.sun} />
      <Circle cx={82} cy={98} r={3.5} fill={C.white} opacity={0.6} />
      <Circle cx={140} cy={122} r={12} fill={C.tomato} />
      <Circle cx={140} cy={122} r={7} fill={C.tomatoDk} />
      <Circle cx={158} cy={134} r={10} fill={C.tomato} />
      <Ellipse cx={126} cy={98} rx={8} ry={4} fill={C.leaf} transform="rotate(-35 126 98)" />
    </>
  );
}

const ART: Record<ArtKind, () => React.ReactElement> = {
  pasta: Pasta,
  salad: Salad,
  rice: Rice,
  soup: Soup,
  toast: Toast,
};

export function FoodArt({ kind, size = 120, plate = true, label }: Props) {
  if (!kind) {
    const initial = (label ?? "").trim().slice(0, 1);
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.surfaceAlt,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: size * 0.56,
            height: size * 0.56,
            borderRadius: size * 0.28,
            backgroundColor: colors.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AppFallbackText initial={initial} size={size} />
        </View>
      </View>
    );
  }
  const Dish = ART[kind];
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        {plate ? (
          <>
            <Circle cx={100} cy={100} r={100} fill={PLATE[kind]} />
            {/* 设计稿的小彩点：阳光、叶子、番茄各一颗。 */}
            <Circle cx={38} cy={48} r={5} fill={C.sun} opacity={0.7} />
            <Circle cx={166} cy={58} r={4} fill={C.leaf} opacity={0.6} />
            <Circle cx={160} cy={160} r={3} fill={C.tomato} opacity={0.5} />
          </>
        ) : null}
        <Dish />
      </Svg>
    </View>
  );
}

function AppFallbackText({ initial, size }: { initial: string; size: number }) {
  return (
    <Text
      allowFontScaling={false}
      style={{
        fontSize: Math.round(size * 0.26),
        fontWeight: "800",
        color: colors.muted,
      }}
    >
      {initial || "菜"}
    </Text>
  );
}

export function WeekDots({ count = 4 }: { count?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {Array.from({ length: count }).map((_, index) => (
        <Svg key={index} width={10} height={10} viewBox="0 0 10 10">
          <Ellipse cx={5} cy={5} rx={4} ry={5} fill={index % 2 === 0 ? colors.leaf : colors.leafSoft} />
        </Svg>
      ))}
    </View>
  );
}

export function TomatoDot({ size = 12 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Circle cx={6} cy={6} r={5} fill={colors.accent} />
      <Rect x={4} y={0} width={4} height={3} rx={1.5} fill={colors.leaf} />
    </Svg>
  );
}
