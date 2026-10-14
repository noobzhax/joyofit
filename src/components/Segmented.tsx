import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, usePalette } from '@/theme';

interface SegmentedProps<T extends string | number> {
  options: readonly { value: T; label: string }[];
  /** Highlighted option; null/unmatched highlights nothing. */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Single-choice row of buttons; the selected one is filled with the accent color. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: SegmentedProps<T>) {
  const palette = usePalette();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.base,
              {
                backgroundColor: selected ? palette.accent : 'transparent',
                borderColor: selected ? palette.accent : palette.border,
                opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
              },
            ]}>
            <Text
              style={[styles.label, { color: selected ? palette.onAccent : palette.text }]}
              numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  base: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '600' },
});
