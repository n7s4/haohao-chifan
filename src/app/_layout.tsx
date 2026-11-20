import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "../theme";
import { GuestMergePrompt } from "../components/GuestMergePrompt";
import { notificationsSupported } from "../lib/cookNotify";
import { BlocksProvider } from "../lib/community/useBlocks";
import { CommunityProfileProvider } from "../lib/community/useCommunityProfile";
import { StoreProvider } from "../state/store";

function useCookNotificationRoutes() {
  useEffect(() => {
    if (!notificationsSupported) return;
    let subscription: { remove: () => void } | null = null;
    let cancelled = false;
    (async () => {
      let Notifications: typeof import("expo-notifications");
      try {
        Notifications = await import("expo-notifications");
      } catch {
        // Expo Go（Android）没有推送相关的原生模块，导入会直接抛错，这里是预期内的降级。
        return;
      }
      const last = await Notifications.getLastNotificationResponseAsync().catch(() => null);
      const route = (response: { notification: { request: { content: { data?: Record<string, unknown> } } } } | null) => {
        const data = response?.notification.request.content.data;
        if (!data || data.kind !== "cook-step" || typeof data.recipeId !== "string") return;
        const step = typeof data.step === "number" ? data.step : 0;
        router.replace({ pathname: "/cook/[id]", params: { id: data.recipeId, step: String(step) } });
      };
      if (last) route(last);
      if (cancelled) return;
      subscription = Notifications.addNotificationResponseReceivedListener(route);
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
}

export default function RootLayout() {
  useCookNotificationRoutes();
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StoreProvider>
            <CommunityProfileProvider>
            <BlocksProvider>
              <StatusBar style="dark" />
              <GuestMergePrompt />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.canvas },
                  animation: "slide_from_right",
                }}
              >
                <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
                <Stack.Screen name="recipe/[id]" />
                <Stack.Screen
                  name="cook/[id]"
                  options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
                />
                <Stack.Screen name="shopping-list" options={{ presentation: "modal" }} />
                <Stack.Screen name="sign-in" options={{ presentation: "modal" }} />
                <Stack.Screen name="create-recipe" options={{ presentation: "modal" }} />
                <Stack.Screen name="account" />
                <Stack.Screen name="fat-loss" />
                <Stack.Screen name="user/[id]" />
                <Stack.Screen name="user/follows" />
              </Stack>
            </BlocksProvider>
            </CommunityProfileProvider>
          </StoreProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
});
