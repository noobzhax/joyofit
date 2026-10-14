import { useEventListener } from 'expo';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { HuaweiWear, type HeartRateEvent } from '@/wear';

/**
 * Live heart rate for the screen that calls it. Realtime heart rate costs watch battery, so it is
 * asked for only while this screen is focused, the app is in the foreground and the link is up, and
 * stopped otherwise (the native module also stops it when the app goes to the background). Returns
 * the latest reading the watch pushed, or null before the first one.
 */
export function useLiveHeartRate(linkUp: boolean): HeartRateEvent | null {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  const [reading, setReading] = useState<HeartRateEvent | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEventListener(HuaweiWear, 'onHeartRate', setReading);

  const wanted = focused && foreground && linkUp;
  useEffect(() => {
    if (!wanted) return;
    HuaweiWear.setLiveHeartRate(true).catch((e: unknown) => console.warn('Live heart rate not started', e));
    return () => {
      HuaweiWear.setLiveHeartRate(false).catch((e: unknown) => console.warn('Live heart rate not stopped', e));
    };
  }, [wanted]);

  return reading;
}
