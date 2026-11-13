/**
 * 蒸汽计时锅 · 做饭模式的标志性动效（对应 ../../../app-redesign/cook.html 的 .stage）。
 *
 * - running：锅盖颠、锅身呼吸、三缕蒸汽轮流升起、偶尔眨眼
 * - paused：锅闭眼打盹，冒「z」
 * - dingKey 变化：到点，锅盖连跳两下
 * - finished：锅盖掀飞、食材从锅里迸出、锅眯眼笑
 *
 * 所有图层共用 300×300 的 viewBox，叠在同一个方框里分别做动画；
 * 系统开了「减少动态效果」时只保留状态切换，不做循环和迸出。
 */
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";

import { colors } from "../theme";

export type PotMode = "running" | "paused" | "finished";

const VB = 300;
const RING_R = 140;
const RING_C = 2 * Math.PI * RING_R;

const POT = "#F05133";
const POT_RIM = "#D2401F";
const POT_HANDLE = "#C3391C";
const CHEEK = "#F4A3A0";
const LID = colors.onDeepTitle;
const FACE = colors.ink;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const ease = Easing.inOut(Easing.quad);

export function SteamPot({
  mode,
  progress,
  dingKey,
  size = 262,
}: {
  mode: PotMode;
  /** 本步剩余比例 1→0，圆环跟着缩短。 */
  progress: number;
  dingKey: number;
  size?: number;
}) {
  const k = size / VB;
  const reduced = useReducedMotion();

  // ---- 圆环 ----
  const ring = useSharedValue(0);
  useEffect(() => {
    const target = mode === "finished" ? RING_C : RING_C * (1 - Math.min(1, Math.max(0, progress)));
    ring.set(withTiming(target, { duration: reduced ? 0 : 320, easing: Easing.linear }));
  }, [progress, mode, reduced, ring]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: ring.value }));
  const ringFade = useSharedValue(1);
  useEffect(() => {
    ringFade.set(withTiming(mode === "finished" ? 0 : 1, { duration: 300 }));
  }, [mode, ringFade]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringFade.value }));

  // ---- 锅盖 ----
  const lidY = useSharedValue(0);
  const lidX = useSharedValue(0);
  const lidRot = useSharedValue(0);
  const lidOpacity = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(lidY);
    cancelAnimation(lidRot);
    if (mode === "finished") {
      if (reduced) {
        lidOpacity.set(withTiming(0, { duration: 250 }));
        return;
      }
      const fly = { duration: 900, easing: Easing.bezier(0.2, 0.8, 0.3, 1) };
      lidY.set(withSequence(withTiming(8, { duration: 180 }), withTiming(-260, fly)));
      lidX.set(withDelay(180, withTiming(120, fly)));
      lidRot.set(withDelay(180, withTiming(200, fly)));
      lidOpacity.set(withDelay(500, withTiming(0, { duration: 580 })));
      return;
    }
    lidX.set(0);
    lidOpacity.set(1);
    if (mode === "running" && !reduced) {
      lidY.set(
        withRepeat(
          withSequence(
            withTiming(-4, { duration: 115, easing: ease }),
            withTiming(-1.5, { duration: 115, easing: ease }),
            withTiming(-3, { duration: 115, easing: ease }),
            withTiming(0, { duration: 115, easing: ease }),
          ),
          -1,
        ),
      );
      lidRot.set(
        withRepeat(
          withSequence(
            withTiming(-2.5, { duration: 115, easing: ease }),
            withTiming(0, { duration: 115, easing: ease }),
            withTiming(2.5, { duration: 115, easing: ease }),
            withTiming(0, { duration: 115, easing: ease }),
          ),
          -1,
        ),
      );
    } else {
      lidY.set(withSpring(0));
      lidRot.set(withSpring(0));
    }
  }, [mode, reduced, lidY, lidX, lidRot, lidOpacity]);

  // 到点：锅盖连跳两下（第一次渲染不跳）。
  useEffect(() => {
    if (dingKey === 0 || reduced) return;
    const hop = withSequence(
      withTiming(-34, { duration: 210, easing: Easing.out(Easing.quad) }),
      withSpring(0, { damping: 7, stiffness: 260 }),
    );
    lidY.set(withSequence(hop, hop));
    lidRot.set(
      withSequence(
        withTiming(-8, { duration: 210 }),
        withSpring(3, { damping: 7, stiffness: 260 }),
        withTiming(-8, { duration: 210 }),
        withSpring(0, { damping: 7, stiffness: 260 }),
      ),
    );
  }, [dingKey, reduced, lidY, lidRot]);

  const lidStyle = useAnimatedStyle(() => ({
    opacity: lidOpacity.value,
    transform: [
      { translateX: lidX.value * k },
      { translateY: lidY.value * k },
      { rotate: `${lidRot.value}deg` },
    ],
  }));

  // ---- 锅身：呼吸 + 完成时弹一下 ----
  const breath = useSharedValue(0);
  const pop = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(breath);
    if (mode === "running" && !reduced) {
      breath.set(withRepeat(withTiming(1, { duration: 700, easing: ease }), -1, true));
    } else {
      breath.set(withTiming(0, { duration: 200 }));
    }
    pop.set(mode === "finished" && !reduced ? withSequence(withTiming(0.94, { duration: 160 }), withSpring(1.06, { damping: 8 })) : withSpring(1));
  }, [mode, reduced, breath, pop]);
  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: pop.value * (1 + 0.015 * breath.value) },
      { scaleY: pop.value * (1 - 0.015 * breath.value) },
    ],
  }));

  // ---- 眼睛：睁眼眨眼 / 闭眼打盹 / 眯眼笑 ----
  const blink = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(blink);
    blink.set(1);
    if (mode === "running" && !reduced) {
      blink.set(
        withRepeat(
          withSequence(
            withDelay(3600, withTiming(0.1, { duration: 110 })),
            withTiming(1, { duration: 130 }),
          ),
          -1,
        ),
      );
    }
  }, [mode, reduced, blink]);
  const openEyesStyle = useAnimatedStyle(() => ({
    opacity: withTiming(mode === "running" ? 1 : 0, { duration: 200 }),
    transform: [{ scaleY: blink.value }],
  }));
  const shutEyesStyle = useAnimatedStyle(() => ({ opacity: withTiming(mode === "paused" ? 1 : 0, { duration: 200 }) }));
  const happyEyesStyle = useAnimatedStyle(() => ({ opacity: withTiming(mode === "finished" ? 1 : 0, { duration: 200 }) }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, ringStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
          <Circle cx={150} cy={150} r={RING_R} fill="none" stroke={colors.deepLine} strokeWidth={8} />
          <AnimatedCircle
            cx={150}
            cy={150}
            r={RING_R}
            fill="none"
            stroke={colors.sun}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${RING_C} ${RING_C}`}
            transform="rotate(-90 150 150)"
            animatedProps={ringProps}
          />
        </Svg>
      </Animated.View>

      {[0, 1, 2].map((i) => (
        <SteamPuff key={i} index={i} active={mode === "running" && !reduced} size={size} />
      ))}

      <Snore active={mode === "paused" && !reduced} k={k} />

      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: "50% 80%" }, bodyStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
          <Ellipse cx={150} cy={252} rx={86} ry={9} fill="#000" fillOpacity={0.25} />
          <Rect x={50} y={160} width={26} height={14} rx={7} fill={POT_HANDLE} />
          <Rect x={224} y={160} width={26} height={14} rx={7} fill={POT_HANDLE} />
          <Path d="M70 146h160v62a40 40 0 0 1-40 40h-80a40 40 0 0 1-40-40z" fill={POT} />
          <Path d="M86 166v40a22 22 0 0 0 22 22" stroke="#fff" strokeOpacity={0.28} strokeWidth={7} fill="none" strokeLinecap="round" />
          <Rect x={62} y={140} width={176} height={16} rx={8} fill={POT_RIM} />
          <Path d="M140 208q10 8 20 0" stroke={FACE} strokeWidth={4} fill="none" strokeLinecap="round" />
          <Circle cx={114} cy={206} r={6} fill={CHEEK} fillOpacity={0.75} />
          <Circle cx={186} cy={206} r={6} fill={CHEEK} fillOpacity={0.75} />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: "50% 64%" }, openEyesStyle]}>
          <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
            <Circle cx={128} cy={192} r={6} fill={FACE} />
            <Circle cx={172} cy={192} r={6} fill={FACE} />
          </Svg>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, shutEyesStyle]}>
          <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
            <Path d="M121 193h14M165 193h14" stroke={FACE} strokeWidth={4} strokeLinecap="round" />
          </Svg>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, happyEyesStyle]}>
          <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
            <Path d="M121 195q7-9 14 0M165 195q7-9 14 0" stroke={FACE} strokeWidth={4} fill="none" strokeLinecap="round" />
          </Svg>
        </Animated.View>
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: "50% 46.67%" }, lidStyle]} pointerEvents="none">
        <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
          <Path d="M68 142Q150 78 232 142z" fill={LID} />
          <Path d="M96 128Q126 104 156 100" stroke="#fff" strokeWidth={6} fill="none" strokeLinecap="round" strokeOpacity={0.7} />
          <Rect x={134} y={88} width={32} height={16} rx={8} fill={colors.sun} />
        </Svg>
      </Animated.View>

      {mode === "finished" && !reduced ? <Burst size={size} /> : null}
    </View>
  );
}

const STEAM_PATHS = ["M118 84c-9-11 9-17 0-30", "M150 76c-9-11 9-17 0-30", "M182 84c-9-11 9-17 0-30"];

function SteamPuff({ index, active, size }: { index: number; active: boolean; size: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(t);
    if (!active) {
      t.set(withTiming(0, { duration: 250 }));
      return;
    }
    t.set(0);
    t.set(withDelay(index * 700, withRepeat(withTiming(1, { duration: 2200, easing: ease }), -1)));
  }, [active, index, t]);
  const k = size / VB;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.35, 1], [0, 0.9, 0]),
    transform: [{ translateY: interpolate(t.value, [0, 1], [8, -16]) * k }, { scaleY: interpolate(t.value, [0, 1], [0.7, 1.1]) }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: `50% ${(84 / VB) * 100}%` }, style]} pointerEvents="none">
      <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
        <Path d={STEAM_PATHS[index]} stroke={colors.onDeepSub} strokeWidth={6} fill="none" strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

function Snore({ active, k }: { active: boolean; k: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(t);
    t.set(0);
    if (active) t.set(withRepeat(withTiming(1, { duration: 2400, easing: ease }), -1));
  }, [active, t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.4, 1], [0, 1, 0]),
    transform: [{ translateX: t.value * 14 * k }, { translateY: -t.value * 26 * k }],
  }));
  return (
    <Animated.Text
      style={[{ position: "absolute", left: 196 * k, top: 82 * k, fontSize: 22 * k, fontWeight: "800", color: colors.onDeepSub }, style]}
    >
      z
    </Animated.Text>
  );
}

// ---- 食材迸出 ----
const BIT_COUNT = 26;
/** 固定种子的伪随机：每次渲染结果一样，不在渲染里调用 Math.random。 */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const BITS = Array.from({ length: BIT_COUNT }, (_, i) => {
  const ang = ((-90 + (rand(i, 1) - 0.5) * 150) * Math.PI) / 180;
  const v = 160 + rand(i, 2) * 180;
  return {
    kind: i % 5,
    dx: Math.cos(ang) * v,
    dy: Math.sin(ang) * v,
    rot: (rand(i, 3) - 0.5) * 720,
    scale: 0.8 + rand(i, 4) * 0.9,
    duration: 1800 + rand(i, 5) * 600,
    delay: 260 + rand(i, 6) * 160,
  };
});

function BitShape({ kind }: { kind: number }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 20 20">
      {kind === 0 ? (
        <G>
          <Circle cx={10} cy={10} r={9} fill={POT} />
          <Circle cx={7} cy={7} r={2.5} fill="#fff" fillOpacity={0.5} />
        </G>
      ) : kind === 1 ? (
        <Ellipse cx={10} cy={10} rx={9} ry={5} fill={colors.leaf} />
      ) : kind === 2 ? (
        <Path d="M2 12c3-6 5 4 8-2s5 4 8-2" stroke={colors.sun} strokeWidth={4} fill="none" strokeLinecap="round" />
      ) : kind === 3 ? (
        <Rect x={4} y={4} width={12} height={12} rx={3} fill="#F59A3C" />
      ) : (
        <Circle cx={10} cy={10} r={5} fill="#FBF6E8" />
      )}
    </Svg>
  );
}

function Burst({ size }: { size: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {BITS.map((bit, i) => (
        <Bit key={i} bit={bit} left={size / 2 - 9} top={(150 / VB) * size} />
      ))}
    </View>
  );
}

function Bit({ bit, left, top }: { bit: (typeof BITS)[number]; left: number; top: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withDelay(bit.delay, withTiming(1, { duration: bit.duration, easing: Easing.bezier(0.2, 0.6, 0.4, 1) })));
  }, [bit, t]);
  const style = useAnimatedStyle(() => {
    const p = t.value;
    const at = [0, 0.35, 0.75, 1];
    return {
      opacity: interpolate(p, [0, 0.35, 0.75, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: interpolate(p, at, [0, bit.dx * 0.6, bit.dx, bit.dx * 1.1]) },
        { translateY: interpolate(p, at, [30, bit.dy * 0.7, bit.dy * 0.6 + 120, bit.dy * 0.2 + 380]) },
        { rotate: `${interpolate(p, at, [0, bit.rot * 0.5, bit.rot, bit.rot * 1.2])}deg` },
        { scale: interpolate(p, at, [0.2, bit.scale, bit.scale, bit.scale * 0.8]) },
      ],
    };
  });
  return (
    <Animated.View style={[{ position: "absolute", left, top }, style]}>
      <BitShape kind={bit.kind} />
    </Animated.View>
  );
}
