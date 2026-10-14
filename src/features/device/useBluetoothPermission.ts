import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

export type PermissionStatus = 'checking' | 'granted' | 'denied' | 'blocked';

/** Android 12 (API 31) introduced the runtime BLUETOOTH_CONNECT permission; older versions grant it at install. */
const RUNTIME_BLUETOOTH_API = 31;

export async function ensureBluetoothConnect(): Promise<Exclude<PermissionStatus, 'checking'>> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < RUNTIME_BLUETOOTH_API) {
    return 'granted';
  }
  const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (await PermissionsAndroid.check(permission)) return 'granted';
  const result = await PermissionsAndroid.request(permission);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}

/** Checks BLUETOOTH_CONNECT on mount and asks for it when it is not yet granted. */
export function useBluetoothPermission() {
  const [status, setStatus] = useState<PermissionStatus>('checking');

  useEffect(() => {
    let live = true;
    void ensureBluetoothConnect().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const request = useCallback(async () => {
    setStatus(await ensureBluetoothConnect());
  }, []);

  return { status, request };
}
