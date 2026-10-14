import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { usePalette } from '@/theme';

interface SwitchRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SwitchRow({ label, value, onValueChange, disabled }: SwitchRowProps) {
  const palette = usePalette();
  return (
    <View style={styles.row}>
      <AppText style={styles.label} muted={disabled}>
        {label}
      </AppText>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: palette.border, true: palette.accent }}
        thumbColor={palette.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  label: { flex: 1 },
});
