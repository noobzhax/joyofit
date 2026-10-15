import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { Divider } from '@/components/Screen';
import { NavRow } from '@/components/NavRow';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { isCancelled, useHrvProgress } from '@/features/hrv/useHrvProgress';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { HuaweiWear } from '@/wear';

const TURN_ON_HINT =
  'Turning it on takes 1 minute of sitting still with the watch snug. The phone measures your beat intervals and sends the watch a baseline.';

/**
 * The watch's automatic stress switch and the way to Measure HRV, inside the Heart rate and sensors section.
 * Turning the switch on runs the calibration minute here; turning it off is immediate.
 */
export function AutomaticStressRows({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(() => HuaweiWear.getStressStatus());
  const [calibrating, setCalibrating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { progress, reset } = useHrvProgress();

  const refresh = useCallback(() => setStatus(HuaweiWear.getStressStatus()), []);
  useNativeRefresh(refresh);

  const change = async (enabled: boolean) => {
    setError(null);
    setBusy(true);
    setCalibrating(enabled);
    if (enabled) reset();
    try {
      setStatus(await HuaweiWear.setAutomaticStress(enabled));
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
      setCalibrating(false);
      refresh();
    }
  };

  const hint = !connected
    ? 'Connect the watch to change it.'
    : !status.supported
      ? 'This watch does not offer it.'
      : status.enabled
        ? `On, as last set here${status.lastCalibratedAt !== null ? `. Calibrated ${formatDateTime(status.lastCalibratedAt)}` : ''}.`
        : TURN_ON_HINT;

  return (
    <>
      <SwitchRow
        icon="pulse"
        label="Automatic stress"
        hint={hint}
        value={status.enabled}
        onValueChange={(value) => void change(value)}
        disabled={busy || !connected || !status.supported}
      />
      {calibrating ? (
        <Notice
          action={{
            label: 'Cancel',
            onPress: () => HuaweiWear.cancelHrvMeasurement().catch((e: unknown) => setError(errorMessage(e))),
          }}>
          {progress
            ? `Calibrating: sit still, ${progress.secondsLeft} s left, ${progress.beats} beats so far.`
            : 'Calibrating: sit still with the watch snug. This takes a minute.'}
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Divider />
      <NavRow
        icon="pulse"
        tint="heart"
        title="Measure HRV"
        subtitle="One minute, from your beat-to-beat intervals"
        onPress={() => router.push('/hrv')}
      />
    </>
  );
}
