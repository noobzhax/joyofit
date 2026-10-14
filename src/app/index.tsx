import { Linking } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Screen, Section } from '@/components/Screen';
import { BondedRow } from '@/features/device/BondedRow';
import { LinkStatus } from '@/features/device/LinkStatus';
import { useBluetoothPermission } from '@/features/device/useBluetoothPermission';
import { useBondedDevices } from '@/features/device/useBondedDevices';
import { formatDateTime } from '@/format';
import { useWatch } from '@/state/WatchProvider';

export default function DeviceScreen() {
  const watch = useWatch();
  const permission = useBluetoothPermission();
  const bonded = useBondedDevices(permission.status === 'granted');
  const { device } = watch;

  return (
    <Screen>
      <Section title="Link">
        <LinkStatus state={watch.linkState} />
        {watch.error ? (
          <AppText variant="caption" danger selectable>
            {watch.error}
          </AppText>
        ) : null}
        {watch.lastSync !== null ? (
          <AppText variant="caption" muted>
            Last sync {formatDateTime(watch.lastSync)}
          </AppText>
        ) : null}
      </Section>

      <Section title="Before you connect">
        <AppText variant="caption">
          Pair the watch in Android Bluetooth settings first. It has to appear in the list below.
        </AppText>
        <AppText variant="caption">
          The watch must not be bound to Huawei Health. Unbind it there, or the watch will refuse
          this app.
        </AppText>
        <AppText variant="caption">
          The first connect needs a confirmation on the watch screen. Keep it awake and accept the
          prompt.
        </AppText>
      </Section>

      <Section title="Paired watches">
        {permission.status === 'checking' ? (
          <AppText variant="caption" muted>
            Checking Bluetooth permission.
          </AppText>
        ) : permission.status !== 'granted' ? (
          <>
            <AppText variant="caption" danger>
              Bluetooth permission is needed to list paired watches and open the connection.
            </AppText>
            {permission.status === 'blocked' ? (
              <Button label="Open app settings" onPress={() => void Linking.openSettings()} />
            ) : (
              <Button label="Allow Bluetooth" variant="primary" onPress={() => void permission.request()} />
            )}
          </>
        ) : (
          <>
            {bonded.error ? (
              <AppText variant="caption" danger>
                Could not read paired devices: {bonded.error}
              </AppText>
            ) : null}
            {bonded.devices.length === 0 && !bonded.loading && !bonded.error ? (
              <AppText variant="caption" muted>
                No paired Bluetooth devices. Pair the watch in Android Bluetooth settings, then
                refresh.
              </AppText>
            ) : null}
            {bonded.devices.map((d) => (
              <BondedRow
                key={d.address}
                device={d}
                linkState={watch.linkState}
                activeAddress={watch.activeAddress}
                onConnect={(address) => void watch.connect(address)}
                onDisconnect={() => void watch.disconnect()}
                onForget={(address) => void watch.forget(address)}
              />
            ))}
            <Button label="Refresh list" loading={bonded.loading} onPress={() => void bonded.reload()} />
          </>
        )}
      </Section>

      {device ? (
        <Section title="Watch">
          <KeyValue label="Name" value={device.name} />
          <KeyValue label="Model" value={device.productModel} />
          <KeyValue label="Software" value={device.softwareVersion} />
          <KeyValue label="Hardware" value={device.hardwareVersion} />
          <KeyValue label="Serial" value={device.serialNumber} />
          <KeyValue label="Auth mode" value={device.authMode} />
          <KeyValue label="Battery" value={watch.battery === null ? null : `${watch.battery}%`} />
          <Button
            label="Refresh battery"
            disabled={watch.linkState !== 'connected'}
            onPress={() => void watch.refreshBattery()}
          />
        </Section>
      ) : null}
    </Screen>
  );
}
