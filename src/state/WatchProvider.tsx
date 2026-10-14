import { useEventListener } from 'expo';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getLastSync } from '@/db/queries';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';
import {
  HuaweiWear,
  type DeviceInfo,
  type FitnessTotals,
  type LinkState,
  type SyncSummary,
} from '@/wear';

export type WatchTotals = FitnessTotals & { at: number };

export interface WatchContextValue {
  linkState: LinkState;
  /** Last connection/sync failure; cleared when a new connect or sync starts. */
  error: string | null;
  /** Address of the watch being connected or connected; null when idle. */
  activeAddress: string | null;
  device: DeviceInfo | null;
  battery: number | null;
  /** `SyncSummary.to` of the last stored sync for the active watch, unix seconds. */
  lastSync: number | null;
  /** Totals reported by the watch in the most recent sync seen by this app session; `at` = `SyncSummary.to`. */
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
  // The background service may already own the link when the UI starts; read it synchronously.
  const [device, setDevice] = useState<DeviceInfo | null>(() => HuaweiWear.getDevice());
  const [activeAddress, setActiveAddress] = useState<string | null>(() =>
    HuaweiWear.getState() === 'disconnected'
      ? null
      : (HuaweiWear.getDevice()?.address ?? HuaweiWear.getBackgroundStatus().address),
  );
  const [battery, setBattery] = useState<number | null>(() => HuaweiWear.getDevice()?.batteryLevel ?? null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [totals, setTotals] = useState<WatchTotals | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const syncing = useRef(false);

  /** Adopts a link that the background service connected while the UI was not watching. */
  const adoptNativeLink = useCallback(async () => {
    const info = HuaweiWear.getDevice();
    const address = info?.address ?? HuaweiWear.getBackgroundStatus().address;
    if (info) {
      setDevice(info);
      setBattery(info.batteryLevel);
    }
    setActiveAddress(address);
    if (address) setLastSync(await getLastSync(db, address));
  }, [db]);

  const applySummary = useCallback((summary: SyncSummary) => {
    setLastSync(summary.to);
    setTotals({ ...summary.totals, at: summary.to });
    setDataVersion((v) => v + 1);
  }, []);

  // Last stored sync of the remembered watch, so Today shows it before any connect.
  useEffect(() => {
    const address = HuaweiWear.getDevice()?.address ?? HuaweiWear.getBackgroundStatus().address;
    if (!address) return;
    let live = true;
    getLastSync(db, address).then(
      (last) => {
        if (live) setLastSync(last);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [db]);

  useEventListener(HuaweiWear, 'onStateChange', (event) => {
    setLinkState(event.state);
    if (event.state === 'connecting') setError(null);
    if (event.error) setError(event.error);
    if (event.state === 'disconnected') {
      setActiveAddress(null);
      setDevice(null);
      setBattery(null);
      return;
    }
    if ((event.state === 'connected' || event.state === 'syncing') && !device) {
      void adoptNativeLink().catch((e) => setError(errorMessage(e)));
    }
    if (!activeAddress) setActiveAddress(HuaweiWear.getBackgroundStatus().address);
  });
  useEventListener(HuaweiWear, 'onBattery', (event) => setBattery(event.level));
  useEventListener(HuaweiWear, 'onLog', pushLog);
  useEventListener(HuaweiWear, 'onSyncComplete', applySummary);

  const connect = useCallback(
    async (address: string) => {
      setError(null);
      setActiveAddress(address);
      try {
        const info = await HuaweiWear.connect(address);
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
      applySummary(await HuaweiWear.syncActivity());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      syncing.current = false;
    }
  }, [device, applySummary]);

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
