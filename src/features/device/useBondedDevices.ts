import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { errorMessage } from '@/format';
import { HuaweiWear, type BondedDevice } from '@/wear';

interface BondedState {
  devices: BondedDevice[];
  loading: boolean;
  error: string | null;
}

/** Supported watches first, then by name. */
function sortBonded(devices: BondedDevice[]): BondedDevice[] {
  return [...devices].sort(
    (a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name),
  );
}

/** Loads bonded devices once permission is granted, and again whenever the tab regains focus. */
export function useBondedDevices(enabled: boolean) {
  const [state, setState] = useState<BondedState>({ devices: [], loading: false, error: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const devices = sortBonded(await HuaweiWear.getBondedDevices());
      setState({ devices, loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(e) }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (enabled) void reload();
    }, [enabled, reload]),
  );

  return { ...state, reload };
}
