import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { NavRow } from '@/components/NavRow';
import { Divider, Screen, Section } from '@/components/Screen';
import { EmptyState, LoadingState, Notice } from '@/components/States';
import { BondedRow } from '@/features/device/BondedRow';
import { FindWatchSection } from '@/features/device/FindWatchSection';
import { SUPPORT_LABEL, supportRank } from '@/features/device/modelSupport';
import { SupportReportSection } from '@/features/device/SupportReportSection';
import { WatchStatusCard } from '@/features/device/WatchStatusCard';
import { useBluetoothPermission } from '@/features/device/useBluetoothPermission';
import { useBondedDevices } from '@/features/device/useBondedDevices';
import { useWatch } from '@/state/WatchProvider';
import { fonts, spacing, useColors } from '@/theme';

const CONNECT_STEPS = [
  'Pair the watch in Android Bluetooth settings. It has to appear in the list below.',
  'Unbind it from Huawei Health first, or the watch will refuse this app.',
  'On the first connect, keep the watch awake and accept the prompt on its screen.',
];

/** The three things that have to be true before the first connect, in the order they happen. */
function ConnectSteps() {
  const colors = useColors();
  return (
    <Section title="Before you connect" icon="list">
      {CONNECT_STEPS.map((step, index) => (
        <View key={step} style={styles.step}>
          <View style={[styles.stepNumber, { backgroundColor: colors.muted }]}>
            <AppText variant="label" style={styles.stepDigit}>
              {index + 1}
            </AppText>
          </View>
          <AppText variant="caption" style={styles.stepText}>
            {step}
          </AppText>
        </View>
      ))}
    </Section>
  );
}

/** Paired watches shown before the list scrolls inside its card. */
const VISIBLE_BONDED = 3;

export default function WatchScreen() {
  const router = useRouter();
  const watch = useWatch();
  const permission = useBluetoothPermission();
  const granted = permission.status === 'granted';
  const bonded = useBondedDevices(granted);
  const { device } = watch;
  // Measured row heights, so the list shows exactly VISIBLE_BONDED rows before it scrolls.
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});

  const showEmpty = bonded.devices.length === 0 && !bonded.loading && !bonded.error;
  const linked = watch.linkState === 'connected' || watch.linkState === 'syncing';

  // The watch in use first, then the ones this app can talk to best.
  const devices = useMemo(
    () =>
      [...bonded.devices].sort(
        (a, b) =>
          Number(b.address === watch.activeAddress) - Number(a.address === watch.activeAddress) ||
          supportRank(a.support) - supportRank(b.support),
      ),
    [bonded.devices, watch.activeAddress],
  );
  const listMaxHeight = useMemo(() => {
    if (devices.length <= VISIBLE_BONDED) return undefined;
    const heights = devices.slice(0, VISIBLE_BONDED).map((d) => rowHeights[d.address]);
    return heights.every((h) => h !== undefined) ? heights.reduce((sum, h) => sum + h, 0) : undefined;
  }, [devices, rowHeights]);

  const pairedWatches = (
    <Section
      title="Paired watches"
      icon="bluetooth"
      trailing={
        devices.length > VISIBLE_BONDED ? (
          <AppText variant="caption" muted>
            {devices.length}
          </AppText>
        ) : null
      }>
      {permission.status === 'checking' ? (
        <LoadingState label="Checking Bluetooth permission" />
      ) : !granted ? (
        <>
          <Notice tone="danger">Bluetooth permission is needed to list paired watches and open the connection.</Notice>
          {permission.status === 'blocked' ? (
            <Button label="Open app settings" icon="settings" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label="Allow Bluetooth" variant="primary" icon="bluetooth" onPress={() => void permission.request()} />
          )}
        </>
      ) : (
        <>
          {bonded.error ? <Notice tone="danger">Could not read paired devices: {bonded.error}</Notice> : null}
          {showEmpty ? (
            <EmptyState
              icon="bluetooth"
              title="No paired devices"
              description="Pair the watch in Android Bluetooth settings, then refresh."
              action={{ label: 'Refresh list', icon: 'refresh', onPress: () => void bonded.reload() }}
            />
          ) : (
            <>
              <ScrollView
                style={listMaxHeight === undefined ? undefined : { maxHeight: listMaxHeight }}
                scrollEnabled={listMaxHeight !== undefined}
                nestedScrollEnabled
                showsVerticalScrollIndicator>
                {devices.map((d, index) => (
                  <View
                    key={d.address}
                    style={[styles.bonded, index > 0 && styles.bondedNext]}
                    onLayout={(e) => {
                      const height = e.nativeEvent.layout.height;
                      setRowHeights((prev) => (prev[d.address] === height ? prev : { ...prev, [d.address]: height }));
                    }}>
                    {index > 0 ? <Divider /> : null}
                    <BondedRow
                      device={d}
                      linkState={watch.linkState}
                      activeAddress={watch.activeAddress}
                      onConnect={(address) => void watch.connect(address)}
                      onDisconnect={() => void watch.disconnect()}
                      onForget={(address) => void watch.forget(address)}
                    />
                  </View>
                ))}
              </ScrollView>
              <Button label="Refresh list" icon="refresh" loading={bonded.loading} onPress={() => void bonded.reload()} />
            </>
          )}
        </>
      )}
    </Section>
  );

  const watchDetails = device ? (
    <Section title="Watch details" icon="watch">
      <KeyValue icon="pricetag" label="Name" value={device.name} />
      <KeyValue icon="watch" label="Model" value={device.model ?? device.productModel} />
      <KeyValue icon="flask" label="JoyoFit support" value={SUPPORT_LABEL[device.support]} />
      {device.model ? <KeyValue icon="hardware-chip" label="Product code" value={device.productModel} /> : null}
      <KeyValue icon="code-slash" label="Software" value={device.softwareVersion} />
      <KeyValue icon="hardware-chip" label="Hardware" value={device.hardwareVersion} />
      <KeyValue icon="barcode" label="Serial" value={device.serialNumber} />
      <KeyValue icon="key" label="Auth mode" value={device.authMode} />
      <KeyValue icon="battery-half" label="Battery" value={watch.battery === null ? null : `${watch.battery}%`} />
      {watch.linkState !== 'connected' ? (
        <AppText variant="caption" muted>
          {watch.linkState === 'syncing' ? 'Available when the sync finishes.' : 'Connect your watch first.'}
        </AppText>
      ) : null}
      <Button
        label="Refresh battery"
        icon="refresh"
        disabled={watch.linkState !== 'connected'}
        onPress={() => void watch.refreshBattery()}
      />
    </Section>
  ) : null;

  const onTheWatch = (
    <Section title="On the watch" icon="watch">
      <NavRow
        icon="color-palette"
        title="Watch faces"
        subtitle="List, switch, delete and install faces"
        style={styles.navRow}
        onPress={() => router.push('/watch/faces')}
      />
      <Divider />
      <NavRow
        icon="images"
        title="Photo face"
        subtitle="Put your own photos on the photo face"
        style={styles.navRow}
        onPress={() => router.push('/watch/photos')}
      />
      <Divider />
      <NavRow
        icon="alarm"
        title="Alarms"
        subtitle="Read and change the watch alarms"
        style={styles.navRow}
        onPress={() => router.push('/watch/alarms')}
      />
    </Section>
  );

  return (
    <Screen
      title="Watch"
      refresh={{ refreshing: bonded.loading, onRefresh: () => void bonded.reload(), enabled: granted }}>
      <WatchStatusCard />
      {/* Connected, the list is only needed to disconnect or switch, so the watch's own pages come first. */}
      {linked ? (
        <>
          {onTheWatch}
          <FindWatchSection />
          {watchDetails}
          {pairedWatches}
          <SupportReportSection />
        </>
      ) : (
        <>
          {device ? null : <ConnectSteps />}
          {pairedWatches}
          {watchDetails}
          {device ? <FindWatchSection /> : null}
          {onTheWatch}
          <SupportReportSection />
        </>
      )}
      {device ? <ConnectSteps /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bonded: { gap: spacing.md },
  bondedNext: { paddingTop: spacing.md },
  navRow: { paddingHorizontal: 0 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepDigit: { fontFamily: fonts.bold, fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, paddingTop: 6 },
});
