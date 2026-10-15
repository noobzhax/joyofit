import { useCallback, useState } from 'react';

import { AppText } from '@/components/AppText';
import { Divider, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { AutomaticStressRows } from '@/features/settings/AutomaticStressRows';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { HuaweiWear, type HealthSensorsUpdate } from '@/wear';

// The thresholds Gadgetbridge offers: high 100 to 150, low 40 to 50 bpm (0 = off).
const HIGH_ALERTS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 100, label: '100' },
  { value: 120, label: '120' },
  { value: 140, label: '140' },
  { value: 150, label: '150' },
];

const LOW_ALERTS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 40, label: '40' },
  { value: 45, label: '45' },
  { value: 50, label: '50' },
];

const UNSUPPORTED = 'This watch does not offer it.';

/**
 * The watch's own heart rate, SpO2 and sleep sensors. They are sent to the watch on every connect;
 * a change here is sent at once when the watch is connected. Without continuous heart rate the
 * watch records no heart rate and Today shows none.
 */
export function HeartRateSection() {
  const [sensors, setSensors] = useState(() => HuaweiWear.getHealthSensors());
  const [error, setError] = useState<string | null>(null);
  const [notSent, setNotSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setSensors(HuaweiWear.getHealthSensors()), []);
  useNativeRefresh(refresh);

  const change = async (patch: Partial<HealthSensorsUpdate>) => {
    const current: HealthSensorsUpdate = {
      automaticHeartRate: sensors.automaticHeartRate,
      automaticSpo2: sensors.automaticSpo2,
      truSleep: sensors.truSleep,
      highHeartRateAlert: sensors.highHeartRateAlert,
      lowHeartRateAlert: sensors.lowHeartRateAlert,
    };
    setBusy(true);
    setError(null);
    try {
      const sent = await HuaweiWear.setHealthSensors({ ...current, ...patch });
      // Not connected (or the watch gave no answer): the choice is stored and goes out on the next connect.
      setNotSent(!sent);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const supported = sensors.supported;
  // Capabilities are only known while connected; until then everything stays switchable.
  const off = (key: keyof NonNullable<typeof supported>) => supported !== null && !supported[key];
  const hint = (key: keyof NonNullable<typeof supported>, text: string) => (off(key) ? UNSUPPORTED : text);

  return (
    <Section title="Heart rate and sensors" icon="heart" tint="heart">
      <SwitchRow
        icon="heart"
        label="Continuous heart rate"
        hint={hint('heartRate', 'The watch records your heart rate about every minute. Without it Today shows no heart rate.')}
        value={sensors.automaticHeartRate}
        onValueChange={(value) => change({ automaticHeartRate: value })}
        disabled={busy || off('heartRate')}
      />
      <Divider />
      <SwitchRow
        icon="water"
        label="Automatic SpO2"
        hint={hint('spo2', 'Measures blood oxygen in the background.')}
        value={sensors.automaticSpo2}
        onValueChange={(value) => change({ automaticSpo2: value })}
        disabled={busy || off('spo2')}
      />
      <Divider />
      <SwitchRow
        icon="moon"
        label="Sleep tracking (TruSleep)"
        hint={hint('truSleep', 'Needed for the sleep stages and the sleep history.')}
        value={sensors.truSleep}
        onValueChange={(value) => change({ truSleep: value })}
        disabled={busy || off('truSleep')}
      />
      <Divider />
      <AutomaticStressRows connected={supported !== null} />
      <Divider />
      <AppText variant="bodyStrong">High heart-rate alert (bpm)</AppText>
      <AppText variant="caption" muted>
        {hint('highHeartRateAlert', 'The watch warns when your heart rate stays above this. Needs continuous heart rate.')}
      </AppText>
      <Segmented
        options={HIGH_ALERTS}
        value={sensors.highHeartRateAlert}
        onChange={(value) => change({ highHeartRateAlert: value })}
        disabled={busy || off('highHeartRateAlert') || !sensors.automaticHeartRate}
      />
      <AppText variant="bodyStrong">Low heart-rate alert (bpm)</AppText>
      <AppText variant="caption" muted>
        {hint('lowHeartRateAlert', 'The watch warns when your heart rate stays below this.')}
      </AppText>
      <Segmented
        options={LOW_ALERTS}
        value={sensors.lowHeartRateAlert}
        onChange={(value) => change({ lowHeartRateAlert: value })}
        disabled={busy || off('lowHeartRateAlert') || !sensors.automaticHeartRate}
      />
      {supported === null ? (
        <Notice>Connect the watch to apply changes. They are saved and sent on the next connect.</Notice>
      ) : notSent ? (
        <Notice>The watch did not confirm every change. See the Log.</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Section>
  );
}
