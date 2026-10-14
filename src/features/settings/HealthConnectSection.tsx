import { useCallback, useEffect, useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type HealthConnectStatus } from '@/wear';

const AVAILABILITY_TEXT: Record<HealthConnectStatus['availability'], string> = {
  available: 'Available',
  'update-required': 'Update the Health Connect app first',
  unavailable: 'Not available on this phone',
};

/** Types written to Health Connect; the count shown next to the permission state. */
const RECORD_TYPE_COUNT = 8;

/**
 * Write the watch data to Health Connect so other apps (JoyoRogo, for one) can read it. The export
 * itself runs in native code after every sync, also when the app is closed; this section only
 * asks for the write permissions, flips the switch and starts the backfill.
 */
export function HealthConnectSection() {
  const { dataVersion } = useWatch();
  const [status, setStatus] = useState<HealthConnectStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    HuaweiWear.getHealthConnectStatus().then(setStatus, (e) => setError(errorMessage(e)));
  }, []);

  useNativeRefresh(refresh);
  // A finished sync may have exported, so re-read the last export time.
  useEffect(refresh, [refresh, dataVersion]);

  const run = async (what: string, action: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const toggle = (next: boolean) =>
    run(next ? 'Asking for permission' : 'Switching off', async () => {
      if (!next) {
        setStatus(await HuaweiWear.setHealthConnectEnabled(false));
        return;
      }
      const afterRequest = await HuaweiWear.requestHealthConnectPermissions();
      if (afterRequest.granted.length === 0) {
        setError('No write permission was granted. Allow JoyoFit in Health Connect to turn this on.');
        return;
      }
      setBusy('Writing stored data');
      setStatus(await HuaweiWear.setHealthConnectEnabled(true));
    });

  const unavailable = status != null && status.availability !== 'available';
  const grantedCount = status?.granted.length ?? 0;

  return (
    <Section title="Health Connect" icon="heart" tint="heart">
      <SwitchRow
        icon="heart"
        label="Write to Health Connect"
        hint={
          status && unavailable
            ? AVAILABILITY_TEXT[status.availability]
            : 'Sends steps, distance, calories, heart rate, blood oxygen, sleep and workouts after every sync, so other apps such as JoyoRogo can read them. Turning it on also writes what is already stored.'
        }
        value={status?.enabled ?? false}
        onValueChange={toggle}
        disabled={busy != null || status == null || unavailable}
      />
      {busy ? (
        <AppText variant="caption" muted>
          {busy}...
        </AppText>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {status?.lastError ? <Notice tone="danger">Last export failed: {status.lastError}</Notice> : null}
      <KeyValue icon="fitness" label="Health Connect" value={status ? AVAILABILITY_TEXT[status.availability] : null} />
      <KeyValue
        icon="key"
        label="Write permission"
        value={status && !unavailable ? `${grantedCount} of ${RECORD_TYPE_COUNT} types` : null}
      />
      {status && status.missing.length > 0 && !unavailable && grantedCount > 0 ? (
        <AppText variant="caption" muted>
          Not allowed, so skipped: {status.missing.join(', ')}.
        </AppText>
      ) : null}
      <KeyValue
        icon="time"
        label="Last export"
        value={status?.lastExportSec ? formatDateTime(status.lastExportSec) : null}
      />
      {status?.lastCounts ? (
        <AppText variant="caption" muted selectable>
          {status.lastCounts}
        </AppText>
      ) : null}
      {status && !unavailable && grantedCount < RECORD_TYPE_COUNT ? (
        <Button
          label="Allow more types"
          variant="secondary"
          icon="add-circle-outline"
          onPress={() =>
            run('Asking for permission', async () => {
              setStatus(await HuaweiWear.requestHealthConnectPermissions());
            })
          }
          disabled={busy != null}
        />
      ) : null}
      {status?.enabled && !unavailable ? (
        <Button
          label="Write everything again"
          variant="secondary"
          icon="refresh"
          onPress={() =>
            run('Writing stored data', async () => {
              await HuaweiWear.backfillHealthConnect();
            })
          }
          disabled={busy != null}
          loading={busy === 'Writing stored data'}
        />
      ) : null}
      {status ? (
        <Button
          label="Open Health Connect"
          variant="ghost"
          icon="open-outline"
          onPress={() => run('Opening', () => HuaweiWear.openHealthConnectSettings())}
          disabled={busy != null}
        />
      ) : null}
    </Section>
  );
}
