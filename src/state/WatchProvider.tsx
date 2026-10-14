import { useEventListener } from 'expo';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getLastSync, saveSyncResult, SYNC_OVERLAP_SEC, upsertDevice } from '@/db/queries';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';
import {
  HuaweiWear,
  type DeviceInfo,
  type FitnessTotals,
  type LinkState,
} from '@/wear';

/** First sync of a watch (no `last_sync` yet) asks for this much history. */
const FIRST_SYNC_LOOKBACK_SEC = 7 * 24 * 3600;

export type WatchTotals = FitnessTotals & { at: number };

export interface WatchContextValue {
  linkState: LinkState;
  /** Last connection/sync failure; cleared when a new connect or sync starts. */
  error: string | null;
  /** Address of the watch being connected or connected; null when idle. */
  activeAddress: string | null;
  device: DeviceInfo | null;
  battery: number | null;
  /** `SyncResult.to` of the last stored sync for the active watch, unix seconds. */
  lastSync: number | null;
  /** Totals reported by the watch in the most recent sync of this app session; `at` = `SyncResult.to`. */
  totals: WatchTotals | null;
  /** Bumped after every stored sync so data screens re-query. */
  dataVersion: number;
  connect: (address: string) => Promise<void>;
  disconnect: () => Promise<void>;
  forget: (address: string) => Promise<void>;
  refreshBattery: () => Promise<void>;
  sync: () => Promise<void>;
}

const WatchContext = createContext<WatchContextValue | null>(null);

export function useWatch(): WatchContextValue {
  const value = useContext(WatchContext);
  if (!value) throw new Error('useWatch must be used inside <WatchProvider>');
  return value;
}

/**
 * Single owner of link state, device info and the native event subscriptions.
 * Mounted once at the root so every tab reads the same state.
 */
export function WatchProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [linkState, setLinkState] = useState<LinkState>(() => HuaweiWear.getState());
  const [error, setError] = useState<string | null>(null);
  const [activeAddress, setActiveAddress] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [totals, setTotals] = useState<WatchTotals | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const syncing = useRef(false);

  useEventListener(HuaweiWear, 'onStateChange', (event) => {
    setLinkState(event.state);
    if (event.state === 'connecting') setError(null);
    if (event.error) setError(event.error);
    if (event.state === 'disconnected') {
      setActiveAddress(null);
      setDevice(null);
      setBattery(null);
    }
  });
  useEventListener(HuaweiWear, 'onBattery', (event) => setBattery(event.level));
  useEventListener(HuaweiWear, 'onLog', pushLog);

  const connect = useCallback(
    async (address: string) => {
      setError(null);
      setActiveAddress(address);
      try {
        const info = await HuaweiWear.connect(address);
        await upsertDevice(db, info);
        setDevice(info);
        setBattery(info.batteryLevel);
        setLastSync(await getLastSync(db, info.address));
      } catch (e) {
        setError(errorMessage(e));
        setActiveAddress(null);
      }
    },
    [db],
  );

  const disconnect = useCallback(async () => {
    try {
      await HuaweiWear.disconnect();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const forget = useCallback(
    async (address: string) => {
      try {
        if (activeAddress === address) await HuaweiWear.disconnect();
        await HuaweiWear.forgetDevice(address);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [activeAddress],
  );

  const refreshBattery = useCallback(async () => {
    try {
      setBattery(await HuaweiWear.refreshBattery());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const sync = useCallback(async () => {
    if (!device || syncing.current) return;
    syncing.current = true;
    setError(null);
    try {
      const last = await getLastSync(db, device.address);
      const from =
        last === null
          ? Math.floor(Date.now() / 1000) - FIRST_SYNC_LOOKBACK_SEC
          : Math.max(0, last - SYNC_OVERLAP_SEC);
      const result = await HuaweiWear.syncActivity(from);
      await saveSyncResult(db, device.address, result);
      setLastSync(result.to);
      setTotals({ ...result.totals, at: result.to });
      setDataVersion((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      syncing.current = false;
    }
  }, [db, device]);

  const value = useMemo<WatchContextValue>(
    () => ({
      linkState,
      error,
      activeAddress,
      device,
      battery,
      lastSync,
      totals,
      dataVersion,
      connect,
      disconnect,
      forget,
      refreshBattery,
      sync,
    }),
    [
      linkState,
      error,
      activeAddress,
      device,
      battery,
      lastSync,
      totals,
      dataVersion,
      connect,
      disconnect,
      forget,
      refreshBattery,
      sync,
    ],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}
