import * as Haptics from "expo-haptics";
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { colors } from "../theme";

const LIFT_SCALE = 1.02;
const REST_DIM = 0.35;

type Handlers = {
  onLift: () => void;
  onMove: (pageX: number, pageY: number) => void;
  onDrop: (pageX: number, pageY: number) => void;
};

function createRelay(initial: Handlers) {
  let current = initial;
  return {
    update(next: Handlers) {
      current = next;
    },
    lift: () => current.onLift(),
    move: (pageX: number, pageY: number) => current.onMove(pageX, pageY),
    drop: (pageX: number, pageY: number) => current.onDrop(pageX, pageY),
  };
}

export function DraggableMeal({
  enabled,
  onLift,
  onMove,
  onDrop,
  placeholder,
  snapBack,
  style,
  children,
}: {
  enabled: boolean;
  onLift: () => void;
  onMove: (pageX: number, pageY: number) => void;
  onDrop: (pageX: number, pageY: number) => void;
  placeholder?: React.ReactNode;
  snapBack?: boolean;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const [lifted, setLifted] = useState(false);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  const dim = useSharedValue(1);
  const snap = useSharedValue(0);
  // 回调随父组件每次渲染变化；放进一个稳定的中转对象，手势回调（经 runOnJS 回到 JS 线程）
  // 每次都取最新那份。不用 ref：React Compiler 会把「手势配置里读 ref」当成渲染期读取。
  const [relay] = useState(() => createRelay({ onLift, onMove, onDrop }));
  useLayoutEffect(() => {
    relay.update({ onLift, onMove, onDrop });
  });
  const { lift: callLift, move: callMove, drop: callDrop } = relay;

  const pan = useMemo(() => {
    const g = Gesture.Pan()
      .enabled(enabled)
      .activateAfterLongPress(260)
      .onStart((e) => {
        scale.set(withSpring(LIFT_SCALE, { damping: 14, stiffness: 220 }));
        dim.set(withTiming(REST_DIM, { duration: 140 }));
        runOnJS(setLifted)(true);
        runOnJS(Haptics.selectionAsync)();
        runOnJS(callLift)();
        runOnJS(callMove)(e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        if (snap.get() === 1) {
          x.set(withSpring(0, { damping: 18, stiffness: 220 }));
          y.set(withSpring(0, { damping: 18, stiffness: 220 }));
        } else {
          x.set(e.translationX);
          y.set(e.translationY);
        }
        runOnJS(callMove)(e.absoluteX, e.absoluteY);
      })
      .onEnd((e) => {
        runOnJS(callDrop)(e.absoluteX, e.absoluteY);
      })
      .onFinalize(() => {
        scale.set(withTiming(1, { duration: 150 }));
        dim.set(withTiming(1, { duration: 150 }));
        x.set(withSpring(0, { damping: 16, stiffness: 200 }));
        y.set(withSpring(0, { damping: 16, stiffness: 200 }));
        runOnJS(setLifted)(false);
      });
    return g;
  }, [enabled, dim, scale, snap, x, y, callLift, callMove, callDrop]);

  useEffect(() => {
    snap.set(snapBack ? 1 : 0);
    if (snapBack) {
      x.set(withSpring(0, { damping: 18, stiffness: 220 }));
      y.set(withSpring(0, { damping: 18, stiffness: 220 }));
    }
  }, [snapBack, snap, x, y]);

  const restStyle = useAnimatedStyle(() => ({ opacity: dim.get() }));
  const copyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { scale: scale.get() },
      // 抬起时微微歪一点，像从桌上拿起一张卡片。
      { rotate: `${(scale.get() - 1) * -75}deg` },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={[style, lifted && styles.liftHost]}>
        <Animated.View style={lifted ? styles.hidden : restStyle}>{children}</Animated.View>
        {lifted && placeholder ? (
          <View style={styles.placeholderLayer} pointerEvents="none">
            {placeholder}
          </View>
        ) : null}
        {lifted ? (
          <Animated.View style={[styles.copy, copyStyle]} pointerEvents="none">
            <View style={styles.copyCard}>
              {children}
              <View style={styles.cornerBadge}>
                <View style={styles.cornerGlyph} />
              </View>
            </View>
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  liftHost: { zIndex: 30, elevation: 12 },
  hidden: { opacity: 0 },
  placeholderLayer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  copy: { position: "absolute", left: -2, right: -2, top: -2 },
  copyCard: {
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.sun,
    backgroundColor: colors.surface,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  cornerBadge: {
    position: "absolute",
    right: -7,
    top: -7,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.sun,
    alignItems: "center",
    justifyContent: "center",
  },
  cornerGlyph: {
    width: 8,
    height: 8,
    borderRightWidth: 1.6,
    borderTopWidth: 1.6,
    borderColor: colors.ink,
    transform: [{ rotate: "45deg" }],
  },
});
