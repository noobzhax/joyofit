import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Calls `refresh` whenever the screen gains focus and whenever the app returns to the foreground
 * (for example from Android settings), so native state read by the caller stays current.
 */
export function useNativeRefresh(refresh: () => void) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      latest.current();
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') latest.current();
    });
    return () => subscription.remove();
  }, []);
}
