/** 新建菜谱页专用的几颗线性图标；风格对齐 components/Icons.tsx（24 栅格、2px 圆头描边）。 */
import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { colors } from "../../theme";

type IconProps = { color?: string; size?: number };

/** 成品图 / 截图占位：相框 + 山 + 太阳。 */
export function ImageIcon({ color = colors.muted, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={4.5} width={17} height={15} rx={3.5} stroke={color} strokeWidth={2} />
      <Circle cx={9} cy={9.6} r={1.6} stroke={color} strokeWidth={1.8} />
      <Path d="m4.5 17 4.6-4.4 3.4 3 2.7-2.3 4.3 3.8" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** 链接 / 粘贴来源。 */
export function LinkIcon({ color = colors.placeholder, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function MinusIcon({ color = colors.ink, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function CameraIcon({ color = colors.ink, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.5-2h4.8l1.5 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12.5} r={3.3} stroke={color} strokeWidth={2} />
    </Svg>
  );
}
