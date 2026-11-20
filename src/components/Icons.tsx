import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { colors } from "../theme";

type IconProps = { color?: string; size?: number; filled?: boolean };

export function HomeIcon({ color = colors.muted, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 10.5 12 3.5l9 7" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.5 9.5V20h13V9.5" stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
    </Svg>
  );
}

export function CalendarIcon({ color = colors.muted, size = 22, filled = false }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3.2}
        y={4.8}
        width={17.6}
        height={16}
        rx={3}
        fill={filled ? color : "none"}
        fillOpacity={filled ? 0.16 : 0}
        stroke={color}
        strokeWidth={1.7}
      />
      <Path d="M3.2 9.2h17.6M8 3v3.4M16 3v3.4" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Path d="M7 12.6h2.4M11 12.6h2.4M15 12.6h2.4M7 16.4h2.4M11 16.4h2.4" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function HeartIcon({ color = colors.muted, size = 22, filled = false }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 20.3s-7.6-4.5-8.9-9.2C2.2 7.6 4.3 4.4 7.7 4.4c2 0 3.3 1.1 4.3 2.4 1-1.3 2.3-2.4 4.3-2.4 3.4 0 5.5 3.2 4.6 6.7-1.3 4.7-8.9 9.2-8.9 9.2Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function StarIcon({ color = colors.accent, size = 18, filled = false }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function UserIcon({ color = colors.muted, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8.2} r={3.9} stroke={color} strokeWidth={1.7} />
      <Path d="M4.8 20.2c0-3.7 3.2-6.2 7.2-6.2s7.2 2.5 7.2 6.2" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

export function SearchIcon({ color = colors.placeholder, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.8} cy={10.8} r={6.4} stroke={color} strokeWidth={1.8} />
      <Path d="m15.6 15.6 4 4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

export function BackIcon({ color = colors.primary, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M14.5 5 7.5 12l7 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChatIcon({ color = colors.ink, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5.5 4.5h13a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.3a.5.5 0 0 1-.8-.4v-2.9H5.5A2.5 2.5 0 0 1 3 15V7a2.5 2.5 0 0 1 2.5-2.5Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path d="M8 10.2h8M8 13.2h5" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function PlusIcon({ color = colors.primary, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4v16M4 12h16" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function CloseIcon({ color = colors.primary, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m6 6 12 12M18 6 6 18" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

export function ClockIcon({ color = colors.muted, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.4} stroke={color} strokeWidth={1.8} />
      <Path d="M12 7.6V12l3 1.9" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CheckIcon({ color = colors.surface, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m5 12.8 4.5 4.4L19 6.6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PlayIcon({ color = colors.surface, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 5.2 19 12 8 18.8V5.2Z" fill={color} />
    </Svg>
  );
}

export function TrashIcon({ color = colors.muted, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4.5 7h15M9.5 7V4.8h5V7M6.8 7l1 12.4h8.4L17.2 7" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function SwapIcon({ color = colors.primary, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8.5h13l-3-3M20 15.5H7l3 3" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronUpIcon({ color = colors.muted, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 15 12 9l6 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronDownIcon({ color = colors.muted, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** 发现 tab：指南针，选中时指针填番茄红（设计稿 .fillable）。 */
export function CompassIcon({ color = colors.muted, size = 22, filled = false }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={filled ? 2.2 : 1.8} />
      <Path
        d="m15.5 8.5-2 5-5 2 2-5z"
        fill={filled ? colors.accent : "none"}
        stroke={filled ? colors.accent : color}
        strokeWidth={filled ? 2.2 : 1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function DiceIcon({ color = colors.ink, size = 15 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={4} width={16} height={16} rx={4.5} stroke={color} strokeWidth={2} />
      <Circle cx={9} cy={9} r={1.3} fill={color} />
      <Circle cx={15} cy={15} r={1.3} fill={color} />
      <Circle cx={15} cy={9} r={1.3} fill={color} />
      <Circle cx={9} cy={15} r={1.3} fill={color} />
    </Svg>
  );
}

export function FlameIcon({ color = colors.muted, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21c3.9 0 6.5-2.6 6.5-6.2 0-3.8-3-5.6-3.9-9.3-1.9 1.4-2.6 3.3-2.6 4.8-1.3-.9-2-2.2-2.1-3.6C7.5 8.7 5.5 11.4 5.5 14.8 5.5 18.4 8.1 21 12 21z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ChevronRightIcon({ color = colors.muted, size = 14 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="m9 5 7 7-7 7" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** AI 排餐：四角星。 */
export function SparkleIcon({ color = colors.ink, size = 17 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z"
        fill={color}
      />
      <Path d="M18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z" fill={color} />
    </Svg>
  );
}

export function BasketIcon({ color = colors.ink, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3.5 10h17l-1.6 8.4a2 2 0 0 1-2 1.6H7.1a2 2 0 0 1-2-1.6z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path d="m8 10 3-5.5M16 10l-3-5.5M9.5 14v2.5M14.5 14v2.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** 拖动把手：两列三行圆点。 */
export function GripIcon({ color = colors.placeholder, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      {[6, 12, 18].map((y) => (
        <React.Fragment key={y}>
          <Circle cx={9} cy={y} r={1.6} />
          <Circle cx={15} cy={y} r={1.6} />
        </React.Fragment>
      ))}
    </Svg>
  );
}
