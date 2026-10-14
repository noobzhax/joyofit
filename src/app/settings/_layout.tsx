import { Stack } from 'expo-router';

import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { initialRouteName: 'index' };

export default function SettingsLayout() {
  return (
    <Stack screenOptions={useStackOptions()}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sync" options={{ title: 'Watch & sync' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications & calls' }} />
      <Stack.Screen name="notification-apps" options={{ title: 'Notification apps' }} />
      <Stack.Screen name="weather" options={{ title: 'Weather' }} />
      <Stack.Screen name="safety" options={{ title: 'Safety' }} />
      <Stack.Screen name="health" options={{ title: 'Health & cloud' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile and goal' }} />
      <Stack.Screen name="meals" options={{ title: 'Meals on watch' }} />
      <Stack.Screen name="goals" options={{ title: 'Goals & reminders' }} />
      <Stack.Screen name="cycle" options={{ title: 'Cycle' }} />
      <Stack.Screen name="courses" options={{ title: 'Running courses' }} />
      <Stack.Screen name="advanced" options={{ title: 'Advanced' }} />
      <Stack.Screen name="log" options={{ title: 'Log' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
    </Stack>
  );
}
