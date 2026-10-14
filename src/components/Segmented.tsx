import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { fontSize, fonts, radius, useColors } from '@/theme';

interface SegmentedProps<T extends string | number> {
  options: readonly { value: T; label: string }[];
  /** Highlighted option; null/unmatched highlights nothing. */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** Single-choice pill control; the selected option is filled with the primary color. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: SegmentedProps<T>) {
  const colors = useColors();
  return (
    <View
      style={[styles.row, { backgroundColor: colors.muted }, disabled && styles.disabled]}
      accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, disabled: !!disabled }}
            disabled={disabled}
            scaleTo={0.96}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && { backgroundColor: colors.primary }]}>
            <Text
              style={[
                styles.label,
                { color: selected ? colors.primaryForeground : colors.foreground },
              ]}
              numberOfLines={1}>
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, gap: 2 },
  disabled: { opacity: 0.55 },
  option: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  label: { fontFamily: fonts.medium, fontSize: fontSize.sm },
});
