import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { canConnect, SUPPORT_LABEL } from '@/features/device/modelSupport';
import { spacing } from '@/theme';
import type { BondedDevice, LinkState } from '@/wear';

interface BondedRowProps {
  device: BondedDevice;
  linkState: LinkState;
  /** Address currently connecting/connected, or null. */
  activeAddress: string | null;
  onConnect: (address: string) => void;
  onDisconnect: () => void;
  onForget: (address: string) => void;
}

export function BondedRow({
  device,
  linkState,
  activeAddress,
  onConnect,
  onDisconnect,
  onForget,
}: BondedRowProps) {
  const isActive = activeAddress === device.address && linkState !== 'disconnected';
  const idle = linkState === 'disconnected';

  function confirmForget() {
    Alert.alert(
      'Forget pairing?',
      'This drops the stored auth key for this watch. The next connect is a first-time bind and has to be confirmed on the watch. Android Bluetooth pairing is not touched.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: () => onForget(device.address) },
      ],
    );
  }

  const connectable = canConnect(device);

  return (
    <View style={styles.row}>
      <View style={[styles.header, !connectable && styles.dimmed]}>
        <IconChip icon="watch" tint={isActive ? 'link' : 'neutral'} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {device.name || 'Unnamed device'}
          </AppText>
          <AppText variant="mono" muted>
            {device.address}
          </AppText>
          <AppText variant="caption" muted>
            {device.model ? `${device.model} · ${SUPPORT_LABEL[device.support]}` : SUPPORT_LABEL[device.support]}
          </AppText>
          {device.reason ? (
            <AppText variant="caption" muted>
              {device.reason}
            </AppText>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        {isActive ? (
          <Button
            label={linkState === 'connecting' ? 'Cancel' : 'Disconnect'}
            onPress={onDisconnect}
            disabled={linkState === 'syncing'}
          />
        ) : (
          <Button
            label="Connect"
            variant="primary"
            disabled={!connectable || !idle}
            onPress={() => onConnect(device.address)}
          />
        )}
        {connectable ? (
          <Button label="Forget pairing" variant="destructive" disabled={!idle && !isActive} onPress={confirmForget} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dimmed: { opacity: 0.55 },
  text: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
