import { Tabs } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';

import { migrate } from '@/db/migrations';
import { WatchProvider } from '@/state/WatchProvider';
import { usePalette } from '@/theme';

const DATABASE_NAME = 'watchfit.db';

export default function RootLayout() {
  const palette = usePalette();
  return (
    <Suspense fallback={null}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrate} useSuspense>
        <WatchProvider>
          <StatusBar style="auto" />
          <Tabs
            screenOptions={{
              headerStyle: { backgroundColor: palette.surface },
              headerTintColor: palette.text,
              headerShadowVisible: false,
              sceneStyle: { backgroundColor: palette.background },
              tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
              tabBarActiveTintColor: palette.accent,
              tabBarInactiveTintColor: palette.textMuted,
              tabBarIcon: () => null,
              tabBarIconStyle: { display: 'none' },
              tabBarLabelStyle: { fontSize: 14, fontWeight: '600' },
            }}>
            <Tabs.Screen name="index" options={{ title: 'Device' }} />
            <Tabs.Screen name="today" options={{ title: 'Today' }} />
            <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
            <Tabs.Screen name="log" options={{ title: 'Log' }} />
          </Tabs>
        </WatchProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
