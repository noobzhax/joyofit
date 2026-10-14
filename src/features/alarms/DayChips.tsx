import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { HIT, useColors } from '@/theme';
import { ALARM_DAYS } from '@/wear';

interface DayChipsProps {
  /** Bitmask of `ALARM_DAYS`. */
  value: number;
  onChange: (value: number) => void;
}

/** Seven round weekday toggles; each sits in a 48 dp tall hit row. */
export function DayChips({ value, onChange }: DayChipsProps) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      {ALARM_DAYS.map((day) => {
        const selected = (value & day.bit) !== 0;
        return (
          <PressableScale
            key={day.bit}
            accessibilityRole="checkbox"
            accessibilityLabel={day.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(selected ? value & ~day.bit : value | day.bit)}
            style={styles.hit}>
            <View style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.muted }]}>
              <AppText variant="label" color={selected ? colors.primaryForeground : colors.foreground}>
                {day.label.slice(0, 2)}
              </AppText>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  hit: { flex: 1, minHeight: HIT, alignItems: 'center', justifyContent: 'center' },
  chip: {
    width: '100%',
    maxWidth: 40,
    aspectRatio: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
