import { Stack } from 'expo-router';

import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { initialRouteName: 'index' };

export default function WorkoutsLayout() {
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Workout' }} />
    </Stack>
  );
}
