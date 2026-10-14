import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';

interface KeyValueProps {
  label: string;
  value: string | null;
}

/** Label/value row; a missing value renders as an em dash instead of being hidden. */
export function KeyValue({ label, value }: KeyValueProps) {
  return (
    <View style={styles.row}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="caption" selectable style={styles.value}>
        {value ?? '\u2014'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  value: { flexShrink: 1, textAlign: 'right' },
});
