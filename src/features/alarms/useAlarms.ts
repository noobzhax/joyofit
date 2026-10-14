import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type WatchAlarms, type WatchAlarmsUpdate } from '@/wear';

/**
 * The watch's alarms: the stored copy at first, replaced by a read from the watch whenever this
 * screen gains focus with a connected watch. `save` pushes a whole new list and shows what the
 * watch reports back.
 */
export function useAlarms() {
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const [alarms, setAlarms] = useState<WatchAlarms>(() => HuaweiWear.getAlarms());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<WatchAlarms>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      setAlarms(await action());
      return true;
    } catch (e) {
      setError(errorMessage(e));
      setAlarms(HuaweiWear.getAlarms());
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(() => run(() => HuaweiWear.refreshAlarms()), [run]);
  const save = useCallback((update: WatchAlarmsUpdate) => run(() => HuaweiWear.setAlarms(update)), [run]);

  useFocusEffect(
    useCallback(() => {
      setAlarms(HuaweiWear.getAlarms());
      if (connected) void refresh();
    }, [connected, refresh]),
  );

  return { alarms, connected, busy, error, refresh, save };
}
