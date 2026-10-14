import { useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { SwitchRow } from '@/components/SwitchRow';
import { Notice } from '@/components/States';
import { ensureBluetoothConnect } from '@/features/device/useBluetoothPermission';
import { useBackgroundStatus } from '@/features/settings/useBackgroundStatus';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

/** Android 13 (API 33) introduced the runtime POST_NOTIFICATIONS permission. */
const RUNTIME_NOTIFICATION_API = 33;

const INTERVALS: readonly { value: number; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
  { value: 240, label: '4 h' },
];

export function BackgroundSection() {
  const { status, refresh } = useBackgroundStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationHidden, setNotificationHidden] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const toggle = (next: boolean) =>
    run(async () => {
      if (!next) {
        await HuaweiWear.setBackgroundEnabled(null);
        return;
      }
      if (!status.address) return;
      setNotificationHidden(false);
      if (Platform.OS === 'android' && Number(Platform.Version) >= RUNTIME_NOTIFICATION_API) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        setNotificationHidden(result !== PermissionsAndroid.RESULTS.GRANTED);
      }
      if ((await ensureBluetoothConnect()) !== 'granted') {
        setError('Bluetooth permission is required to stay connected in the background.');
        return;
      }
      await HuaweiWear.setBackgroundEnabled(status.address);
    });

  return (
    <Section title="Background" icon="sync">
      <SwitchRow
        icon="sync"
        label="Keep connected in the background"
        hint={
          !status.address
            ? 'Connect your watch first.'
            : 'Keeps the link to the watch up while the app is closed.'
        }
        value={status.enabled}
        onValueChange={toggle}
        disabled={busy || (!status.enabled && !status.address)}
      />
      {notificationHidden ? (
        <Notice>Notification permission was denied, so the service notification is hidden.</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <KeyValue icon="watch" label="Watch" value={status.name ?? status.address} />
      <KeyValue icon="pulse" label="Service" value={status.running ? 'Running' : 'Stopped'} />
      {status.enabled ? (
        <KeyValue
          icon="refresh"
          label="Auto-reconnect"
          value={status.paused ? 'Paused. Connect again to resume.' : 'Active'}
        />
      ) : null}
      <AppText variant="label" muted>
        Sync interval
      </AppText>
      <Segmented
        options={INTERVALS}
        value={status.syncIntervalMinutes}
        onChange={(minutes) => run(() => HuaweiWear.setSyncIntervalMinutes(minutes))}
        disabled={busy}
      />
    </Section>
  );
}
