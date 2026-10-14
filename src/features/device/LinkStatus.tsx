import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { usePalette } from '@/theme';
import type { LinkState } from '@/wear';

const LABEL: Record<LinkState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  authenticating: 'Authenticating',
  initializing: 'Initializing',
  connected: 'Connected',
  syncing: 'Syncing',
};

/** Live link state. The dot is filled in the accent while the link is up, hollow when down, muted in transition. */
export function LinkStatus({ state }: { state: LinkState }) {
  const palette = usePalette();
  const up = state === 'connected' || state === 'syncing';
  const down = state === 'disconnected';
  return (
    <View style={styles.row} accessible accessibilityLabel={`Link state: ${LABEL[state]}`}>
      <View
        style={[
          styles.dot,
          {
            borderColor: up ? palette.accent : palette.textMuted,
            backgroundColor: up ? palette.accent : down ? 'transparent' : palette.textMuted,
          },
        ]}
      />
      <AppText variant="title">{LABEL[state]}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
});
