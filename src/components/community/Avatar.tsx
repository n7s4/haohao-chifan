import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { colors } from "../../theme";
import { AppText } from "../Common";

/** 社区里的圆形头像：没有图或加载失败时显示昵称首字。 */
export function Avatar({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri && !failed) {
    return <Image alt={name} source={{ uri }} style={[styles.avatar, box]} onError={() => setFailed(true)} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, box]}>
      <AppText size={Math.round(size * 0.42)} weight="800" color={colors.accentText}>
        {Array.from(name)[0] ?? ""}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.surfaceAlt },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft },
});
