import { Tabs } from "expo-router/js-tabs";
import type { BottomTabBarButtonProps } from "expo-router/js-tabs";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CalendarIcon, HeartIcon, HomeIcon, PlusIcon, UserIcon } from "../../components/Icons";
import { colors } from "../../theme";

/** 中间的「+」不是普通 tab：不切换选中态，直接推开录菜页。 */
function CreateTabButton(_props: BottomTabBarButtonProps) {
  return (
    <Pressable
      onPress={() => router.push("/create-recipe")}
      accessibilityRole="button"
      accessibilityLabel="自己录一道菜"
      style={styles.createSlot}
    >
      <View style={styles.createBadge}>
        <PlusIcon size={21} color={colors.white} />
      </View>
    </Pressable>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orangeText,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500", marginTop: 2 },
        tabBarStyle: {
          height: 58 + insets.bottom,
          paddingTop: 7,
          paddingBottom: insets.bottom + 8,
          backgroundColor: colors.cream,
          borderTopColor: colors.line,
        },
        sceneStyle: { backgroundColor: colors.cream },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "发现",
          tabBarIcon: ({ color }) => <HomeIcon size={21} color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: "计划",
          tabBarIcon: ({ color }) => <CalendarIcon size={21} color={String(color)} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "新建",
          tabBarLabel: () => null,
          tabBarButton: (props) => <CreateTabButton {...props} />,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: "收藏",
          tabBarIcon: ({ color, focused }) => (
            <HeartIcon size={21} color={String(color)} filled={Boolean(focused)} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "我的",
          tabBarIcon: ({ color }) => <UserIcon size={21} color={String(color)} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  createSlot: { flex: 1, alignItems: "center", justifyContent: "center" },
  createBadge: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.orange,
    alignItems: "center",
    justifyContent: "center",
  },
});
