import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, usePalette } from '@/theme';
import { ALARM_DAYS } from '@/wear';

interface DayChipsProps {
  /** Bitmask of `ALARM_DAYS`. */
  value: number;
  onChange: (value: number) => void;
}

/** Seven toggles for the weekdays of an alarm. */
export function DayChips({ value, onChange }: DayChipsProps) {
  const palette = usePalette();
  return (
    <View style={styles.row}>
      {ALARM_DAYS.map((day) => {
        const selected = (value & day.bit) !== 0;
        return (
          <Pressable
            key={day.bit}
            accessibilityRole="checkbox"
            accessibilityLabel={day.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(selected ? value & ~day.bit : value | day.bit)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? palette.accent : 'transparent',
                borderColor: selected ? palette.accent : palette.border,
              },
            ]}>
            <Text style={[styles.label, { color: selected ? palette.onAccent : palette.text }]}>
              {day.label.slice(0, 2)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '600' },
});
