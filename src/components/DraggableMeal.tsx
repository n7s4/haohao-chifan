import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const handlers = useRef({ onLift, onMove, onDrop });
  handlers.current = { onLift, onMove, onDrop };

  const pan = useMemo(() => {
    const g = Gesture.Pan()
      .enabled(enabled)
      .activateAfterLongPress(260)
      .minDistance(0)
      .onStart((e) => {
        scale.value = withSpring(LIFT_SCALE, { damping: 14, stiffness: 220 });
        dim.value = withTiming(REST_DIM, { duration: 140 });
        runOnJS(setLifted)(true);
        runOnJS(Haptics.selectionAsync)();
        runOnJS(handlers.current.onLift)();
        runOnJS(handlers.current.onMove)(e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        if (snap.value === 1) {
          x.value = withSpring(0, { damping: 18, stiffness: 220 });
          y.value = withSpring(0, { damping: 18, stiffness: 220 });
        } else {
          x.value = e.translationX;
          y.value = e.translationY;
        }
        runOnJS(handlers.current.onMove)(e.absoluteX, e.absoluteY);
      })
      .onEnd((e) => {
        runOnJS(handlers.current.onDrop)(e.absoluteX, e.absoluteY);
      })
      .onFinalize(() => {
        scale.value = withTiming(1, { duration: 150 });
        dim.value = withTiming(1, { duration: 150 });
        x.value = withSpring(0, { damping: 16, stiffness: 200 });
        y.value = withSpring(0, { damping: 16, stiffness: 200 });
        runOnJS(setLifted)(false);
      });
    return g;
  }, [enabled, dim, scale, snap, x, y]);

  useEffect(() => {
    snap.value = snapBack ? 1 : 0;
    if (snapBack) {
      x.value = withSpring(0, { damping: 18, stiffness: 220 });
      y.value = withSpring(0, { damping: 18, stiffness: 220 });
    }
  }, [snapBack, snap, x, y]);

  const restStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const copyStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
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
    borderColor: colors.orange,
    backgroundColor: colors.cream,
    shadowColor: "#2E4636",
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
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  cornerGlyph: {
    width: 8,
    height: 8,
    borderRightWidth: 1.6,
    borderTopWidth: 1.6,
    borderColor: colors.cream,
    transform: [{ rotate: "45deg" }],
  },
});
