import { useEventListener } from 'expo';
import { useRootNavigationState, useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { isActive } from '@/features/live/liveWorkout';
import { HuaweiWear, type LiveWorkout } from '@/wear';

const LiveWorkoutContext = createContext<LiveWorkout | null | undefined>(undefined);

/** The workout started on the watch, or the last one until dismissed; null when none. */
export function useLiveWorkout(): LiveWorkout | null {
  const value = useContext(LiveWorkoutContext);
  if (value === undefined) throw new Error('useLiveWorkout must be used inside <LiveWorkoutProvider>');
  return value;
}

/**
 * Follows a workout started on the watch (native `LiveWorkout.kt`). When one starts while the app is open, or the app
 * opens during one, the live screen opens by itself, once per workout. With the app closed the native notification
 * links to the same screen.
 */
export function LiveWorkoutProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Navigating before the tabs are mounted throws; the key appears once they are.
  const navigatorReady = useRootNavigationState()?.key !== undefined;
  const [live, setLive] = useState<LiveWorkout | null>(() => HuaweiWear.getLiveWorkout());
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  const opened = useRef<number | null>(null);

  useEventListener(HuaweiWear, 'onLiveWorkout', setLive);

  // A JS reload or a return from the background may have missed events.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') setLive(HuaweiWear.getLiveWorkout());
    });
    return () => subscription.remove();
  }, []);

  const activeId = isActive(live) ? live.id : null;
  useEffect(() => {
    if (activeId === null || opened.current === activeId || !foreground || !navigatorReady) return;
    opened.current = activeId;
    router.navigate('/workout-live');
  }, [activeId, foreground, navigatorReady, router]);

  return <LiveWorkoutContext.Provider value={live}>{children}</LiveWorkoutContext.Provider>;
}
