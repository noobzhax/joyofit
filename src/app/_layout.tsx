import { Ionicons } from '@expo/vector-icons';
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { migrate } from '@/db/migrations';
import { serializeQueries } from '@/db/serialize';
import { CloudProvider } from '@/state/CloudProvider';
import { LiveWorkoutProvider } from '@/state/LiveWorkoutProvider';
import { MealsProvider } from '@/state/MealsProvider';
import { WatchProvider } from '@/state/WatchProvider';
import { fonts, useColors } from '@/theme';

const DATABASE_NAME = 'joyofit.db';

/** Schema first, then one query at a time on the shared handle (see `serialize.ts`). */
async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await migrate(db);
  serializeQueries(db);
}

// Hold the splash until the fonts and tab icons are ready, so the first frame is already typeset.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const colors = useColors();
  const scheme = useColorScheme();
  const [fontsReady, fontError] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    ...Ionicons.font,
  });
  const ready = fontsReady || fontError !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={initDatabase} useSuspense>
        <WatchProvider>
          <CloudProvider>
            <MealsProvider>
              <LiveWorkoutProvider>
                <StatusBar style="auto" />
                {/* Keyed by scheme: the tab bar kept its first colors when the theme flipped while the app was open. */}
                <Tabs
                  key={scheme}
                  screenOptions={{
                    headerShown: false,
                    sceneStyle: { backgroundColor: colors.background },
                    tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.hairline },
                    tabBarActiveTintColor: colors.primary,
                    tabBarInactiveTintColor: colors.mutedForeground,
                    tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
                  }}>
                  <Tabs.Screen
                    name="index"
                    options={{
                      title: 'Today',
                      tabBarIcon: ({ focused, color, size }) => (
                        <Ionicons name={focused ? 'today' : 'today-outline'} size={size} color={color} />
                      ),
                    }}
                  />
                  <Tabs.Screen
                    name="workouts"
                    options={{
                      title: 'Workouts',
                      tabBarIcon: ({ focused, color, size }) => (
                        <Ionicons name={focused ? 'fitness' : 'fitness-outline'} size={size} color={color} />
                      ),
                    }}
                  />
                  <Tabs.Screen
                    name="watch"
                    options={{
                      title: 'Watch',
                      tabBarIcon: ({ focused, color, size }) => (
                        <Ionicons name={focused ? 'watch' : 'watch-outline'} size={size} color={color} />
                      ),
                    }}
                  />
                  <Tabs.Screen
                    name="settings"
                    options={{
                      title: 'Settings',
                      tabBarIcon: ({ focused, color, size }) => (
                        <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />
                      ),
                    }}
                  />
                  {/* Old deep links; each redirects to where the screen lives now. */}
                  <Tabs.Screen name="today" options={{ href: null }} />
                  <Tabs.Screen name="log" options={{ href: null }} />
                  <Tabs.Screen name="alarms" options={{ href: null }} />
                  <Tabs.Screen name="watchfaces" options={{ href: null }} />
                  {/* Pushed from Today (or Settings, for hrv); each draws its own header (HiddenTabHeader). */}
                  <Tabs.Screen name="health" options={{ href: null }} />
                  <Tabs.Screen name="hrv" options={{ href: null }} />
                  <Tabs.Screen name="sleep" options={{ href: null }} />
                  <Tabs.Screen name="readiness" options={{ href: null }} />
                  <Tabs.Screen name="trends" options={{ href: null }} />
                  {/* Opens by itself when a workout starts on the watch (LiveWorkoutProvider). */}
                  <Tabs.Screen name="workout-live" options={{ href: null }} />
                </Tabs>
              </LiveWorkoutProvider>
            </MealsProvider>
          </CloudProvider>
        </WatchProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
