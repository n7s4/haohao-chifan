import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

import { ArtKind } from "../data/recipes";
import { colors } from "../theme";

type Props = {
  kind?: ArtKind;
  size?: number;
  plate?: boolean;
  /** 没有插画时用菜名首字兜底；比按名字 hash 挑一张不相关的图准确。 */
  label?: string;
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
          backgroundColor: "#EFE3CF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <AppFallbackText initial={initial} size={size} />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 240 240">
        {plate ? (
          <>
            <Circle cx={120} cy={120} r={110} fill="#E6DDCA" />
            <Circle cx={120} cy={120} r={99} fill="#FFFEFA" />
            <Circle cx={120} cy={120} r={80} fill="#F4ECD6" />
          </>
        ) : null}
        {kind === "pasta" ? (
          <>
            <Path
              d="M72 72 Q150 65 161 82 Q156 103 123 126 Q99 147 78 171 L165 172"
              fill="none"
              stroke="#EAB052"
              strokeWidth={16}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx={74} cy={112} r={16} fill="#D76543" />
            <Circle cx={158} cy={160} r={16} fill="#D76543" />
            <Path d="M139 57 C91 49 100 98 121 124 C151 109 163 82 139 57" fill="#426B46" />
          </>
        ) : null}
        {kind === "salad" ? (
          <>
            <Circle cx={87} cy={89} r={22} fill="#7E9A60" />
            <Circle cx={147} cy={83} r={23} fill="#88A66A" />
            <Circle cx={153} cy={149} r={25} fill="#78985B" />
            <Circle cx={98} cy={157} r={23} fill="#7E9A60" />
            <Path d="M110 69 Q156 64 131 133 Q106 127 110 69" fill="#3E6645" />
            <Path d="M88 110 Q103 89 117 110 L127 139 Q96 144 88 110" fill="#EAB052" />
            <Circle cx={144} cy={117} r={12} fill="#F4D48A" />
          </>
        ) : null}
        {kind === "rice" ? (
          <>
            <Path d="M62 132 Q120 96 178 132 L166 176 Q120 198 74 176 Z" fill="#F1E6CE" />
            <Circle cx={98} cy={124} r={15} fill="#C79A5E" />
            <Circle cx={126} cy={112} r={17} fill="#8A6A43" />
            <Circle cx={150} cy={128} r={14} fill="#C79A5E" />
            <Circle cx={112} cy={146} r={13} fill="#E06040" />
            <Circle cx={143} cy={152} r={12} fill="#6C8A52" />
          </>
        ) : null}
        {kind === "soup" ? (
          <>
            <Circle cx={120} cy={124} r={72} fill="#E8A25C" />
            <Circle cx={120} cy={124} r={58} fill="#F0B771" />
            <Circle cx={106} cy={112} r={12} fill="#F7DDB4" opacity={0.85} />
            <Circle cx={136} cy={140} r={8} fill="#F7DDB4" opacity={0.7} />
            <Path d="M96 90 Q112 74 128 90" stroke="#6C8A52" strokeWidth={9} strokeLinecap="round" fill="none" />
          </>
        ) : null}
        {kind === "toast" ? (
          <>
            <Path d="M66 96 Q66 74 88 74 L152 74 Q174 74 174 96 L174 168 Q174 184 158 184 L82 184 Q66 184 66 168 Z" fill="#E2B87C" />
            <Path d="M80 104 Q80 90 94 90 L146 90 Q160 90 160 104 L160 166 L80 166 Z" fill="#F6EBD4" />
            <Circle cx={110} cy={126} r={18} fill="#FFFDF6" />
            <Circle cx={110} cy={126} r={9} fill="#EAB052" />
            <Circle cx={142} cy={150} r={11} fill="#D76543" />
            <Path d="M84 92 Q120 78 156 92" stroke="#88A66A" strokeWidth={8} strokeLinecap="round" fill="none" />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

function AppFallbackText({ initial, size }: { initial: string; size: number }) {
  return (
    <Text
      allowFontScaling={false}
      style={{
        fontSize: Math.round(size * 0.34),
        fontWeight: "600",
        color: colors.green,
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
          <Ellipse cx={5} cy={5} rx={4} ry={5} fill={index % 2 === 0 ? "#7E9A60" : "#C6D3C0"} />
        </Svg>
      ))}
    </View>
  );
}

export function TomatoDot({ size = 12 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Circle cx={6} cy={6} r={5} fill="#D76543" />
      <Rect x={4} y={0} width={4} height={3} rx={1.5} fill="#426B46" />
    </Svg>
  );
}
