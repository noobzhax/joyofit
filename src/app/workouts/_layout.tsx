import { Stack } from 'expo-router';

import { usePalette } from '@/theme';

export default function WorkoutsLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: palette.background },
      }}>
      <Stack.Screen name="index" options={{ title: 'Workouts' }} />
      <Stack.Screen name="[id]" options={{ title: 'Workout' }} />
    </Stack>
  );
}
