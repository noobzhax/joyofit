import { useCallback, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatClock } from '@/format';
import {
  HuaweiWear,
  type TemperatureUnit,
  type WeatherLocationMode,
  type WeatherStatus,
} from '@/wear';

const UNITS: readonly { value: TemperatureUnit; label: string }[] = [
  { value: 'celsius', label: '\u00B0C' },
  { value: 'fahrenheit', label: '\u00B0F' },
];

const MODES: readonly { value: WeatherLocationMode; label: string }[] = [
  { value: 'current', label: 'This phone' },
  { value: 'city', label: 'A city' },
];

const INTERVALS: readonly { value: number; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
  { value: 240, label: '4 h' },
];

/** Asks for the coarse location; true when granted. The native side also accepts the fine one. */
async function ensureCoarseLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

/** "Sunny" from the Huawei icon name `SUNNY`, "Light rain" from `LIGHT_RAIN`. */
function conditionLabel(icon: string): string {
  const text = icon.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function WeatherSection() {
  const [status, setStatus] = useState<WeatherStatus>(() => HuaweiWear.getWeatherStatus());
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);

  const refresh = useCallback(() => setStatus(HuaweiWear.getWeatherStatus()), []);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ text: done, danger: false });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** Selecting or enabling `current` needs the permission; without it the watch is told so. */
  const askLocation = async () => {
    if (!(await ensureCoarseLocation())) {
      setMessage({
        text: 'Location permission was denied. Weather for this phone cannot be fetched until it is allowed; choose a city instead.',
        danger: true,
      });
    }
  };

  const toggle = (enabled: boolean) =>
    run(async () => {
      if (enabled && status.locationMode === 'current') await askLocation();
      await HuaweiWear.setWeatherEnabled(enabled);
    });

  const chooseMode = (mode: WeatherLocationMode) =>
    run(async () => {
      if (mode === 'current') await askLocation();
      await HuaweiWear.setWeatherLocationMode(mode);
    });

  const search = () =>
    run(async () => {
      const place = await HuaweiWear.setWeatherCity(city);
      setCity('');
      setMessage({
        text: `City set to ${place.name}${place.detail ? ` (${place.detail})` : ''}.`,
        danger: false,
      });
    });

  const connected = status.watchSupported !== null;

  return (
    <Section title="Weather" icon="partly-sunny">
      <SwitchRow
        icon="partly-sunny"
        label="Send weather to the watch"
        hint="Sends current weather and a forecast. Data comes from Open-Meteo; only coordinates rounded to about 1 km go out."
        value={status.enabled}
        onValueChange={toggle}
        disabled={busy}
      />

      <AppText variant="label" muted>
        Temperature unit
      </AppText>
      <Segmented
        options={UNITS}
        value={status.unit}
        onChange={(unit) => run(() => HuaweiWear.setWeatherUnit(unit))}
        disabled={busy}
      />

      <AppText variant="label" muted>
        Weather for
      </AppText>
      <Segmented options={MODES} value={status.locationMode} onChange={chooseMode} disabled={busy} />
      {status.locationMode === 'current' ? (
        <>
          <KeyValue
            icon="location"
            label="Location permission"
            value={status.locationPermission ? 'Granted' : 'Not granted'}
          />
          {!status.locationPermission ? (
            <Button
              label="Allow location"
              variant="secondary"
              icon="location-outline"
              onPress={() =>
                run(async () => {
                  await askLocation();
                })
              }
              disabled={busy}
            />
          ) : null}
          <AppText variant="caption" muted>
            Uses the last known coarse location. In the background Android may not give a fresh one,
            so the last position is reused.
          </AppText>
        </>
      ) : (
        <>
          <KeyValue
            icon="business"
            label="City"
            value={
              status.city
                ? `${status.city.name}${status.city.detail ? `, ${status.city.detail}` : ''}`
                : null
            }
          />
          <Input
            icon="search"
            accessibilityLabel="City name"
            placeholder="City, or City, Country"
            value={city}
            onChangeText={setCity}
            onSubmitEditing={search}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Button label="Search city" variant="secondary" onPress={search} disabled={busy || !city.trim()} />
        </>
      )}

      <AppText variant="label" muted>
        Update interval
      </AppText>
      <Segmented
        options={INTERVALS}
        value={status.intervalMinutes}
        onChange={(minutes) => run(() => HuaweiWear.setWeatherIntervalMinutes(minutes))}
        disabled={busy}
      />

      {message ? <Notice tone={message.danger ? 'danger' : 'info'}>{message.text}</Notice> : null}
      <Button
        label="Update now"
        variant="primary"
        icon="refresh"
        loading={busy}
        disabled={!status.enabled || !connected}
        onPress={() => run(async () => void (await HuaweiWear.refreshWeather()), 'Sent to the watch.')}
      />
      {!connected ? (
        <AppText variant="caption" muted>
          Connect your watch to send weather. It is sent on every connect.
        </AppText>
      ) : status.watchSupported === false ? (
        <Notice tone="danger">This watch does not list the weather service.</Notice>
      ) : null}
      <KeyValue
        icon="time"
        label="Last sent"
        value={status.lastPushAt ? formatClock(status.lastPushAt) : null}
      />
      <KeyValue
        icon="thermometer"
        label="Last weather"
        value={
          status.lastTemperatureC !== null && status.lastCondition
            ? `${status.lastTemperatureC}\u00B0C, ${conditionLabel(status.lastCondition)}${
                status.lastLocationName ? `, ${status.lastLocationName}` : ''
              }`
            : null
        }
      />
      {status.lastError ? <Notice tone="danger">{status.lastError}</Notice> : null}
    </Section>
  );
}
