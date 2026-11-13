import { Tabs } from "expo-router/js-tabs";
import React from "react";

import { TabBar } from "../../components/TabBar";
import { colors } from "../../theme";

/**
 * 外观全部在 TabBar 里（iOS 居中新建 / Android M3 导航栏）。
 * 这里只声明路由顺序；「create」路由保留占位，iOS 渲染成中间的「+」，Android 不显示。
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "发现" }} />
      <Tabs.Screen name="plan" options={{ title: "计划" }} />
      <Tabs.Screen name="create" options={{ title: "新建" }} />
      <Tabs.Screen name="favorites" options={{ title: "收藏" }} />
      <Tabs.Screen name="profile" options={{ title: "我的" }} />
    </Tabs>
  );
}
