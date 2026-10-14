import { Stack } from 'expo-router';

import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { initialRouteName: 'index' };

export default function WatchLayout() {
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="alarms" options={{ title: 'Alarms' }} />
      <Stack.Screen name="faces" options={{ title: 'Watch faces' }} />
    </Stack>
  );
}
