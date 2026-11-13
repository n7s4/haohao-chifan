import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "./Common";
import { CloseIcon } from "./Icons";
import { colors } from "../theme";

export type ViewerImage = { key: string; uri: string; caption?: string };

/**
 * 全屏看大图：黑底、contain 铺满，左右滑切换，点图或右上角关闭；安卓返回键同样关闭。
 * `startIndex` 为 null 时不渲染。
 */
export function ImageViewer({
  images,
  startIndex,
  onClose,
}: {
  images: ViewerImage[];
  startIndex: number | null;
  onClose: () => void;
}) {
  if (startIndex === null || !images.length) return null;
  // 每次打开按起始图重新挂载，当前页码从 props 初始化，不用在 effect 里回填。
  return <ViewerBody key={startIndex} images={images} startIndex={startIndex} onClose={onClose} />;
}

function ViewerBody({
  images,
  startIndex,
  onClose,
}: {
  images: ViewerImage[];
  startIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    // 安卓上 contentOffset 初值不生效，挂载后再跳一次。
    const frame = requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ x: startIndex * width, animated: false })
    );
    return () => cancelAnimationFrame(frame);
  }, [startIndex, width]);

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(Math.max(0, Math.min(images.length - 1, next)));
  };

  const caption = images[index]?.caption;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <View style={styles.backdrop}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: startIndex * width, y: 0 }}
          onMomentumScrollEnd={onMomentumEnd}
        >
          {images.map((image) => (
            <Pressable
              key={image.key}
              onPress={onClose}
              accessibilityLabel="关闭大图"
              style={{ width, height, justifyContent: "center" }}
            >
              <Image
                alt={image.caption ?? "大图"}
                source={{ uri: image.uri }}
                style={{ width, height }}
                resizeMode="contain"
              />
            </Pressable>
          ))}
        </ScrollView>

        <View style={[styles.topRow, { top: insets.top + 8 }]} pointerEvents="box-none">
          {images.length > 1 ? (
            <AppText size={15} weight="700" color={colors.white}>
              {index + 1} / {images.length}
            </AppText>
          ) : (
            <View />
          )}
          <Pressable onPress={onClose} accessibilityLabel="关闭" hitSlop={8} style={styles.closeBtn}>
            <CloseIcon size={20} color={colors.white} />
          </Pressable>
        </View>

        {caption ? (
          <View style={[styles.caption, { bottom: insets.bottom + 20 }]} pointerEvents="none">
            <AppText size={14} color={colors.white} numberOfLines={3} style={{ lineHeight: 21 }}>
              {caption}
            </AppText>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000" },
  topRow: {
    position: "absolute",
    left: 20,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  caption: {
    position: "absolute",
    left: 20,
    right: 20,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
});
