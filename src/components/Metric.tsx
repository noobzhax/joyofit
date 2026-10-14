import { StyleSheet, Text } from 'react-native';

import { fonts, useColors } from '@/theme';

const SIZES = {
  hero: { value: 56, line: 60, unit: 15, tracking: -1.5 },
  lg: { value: 32, line: 38, unit: 14, tracking: -0.5 },
  md: { value: 24, line: 30, unit: 13, tracking: -0.3 },
  sm: { value: 18, line: 24, unit: 12, tracking: 0 },
} as const;

interface MetricProps {
  value: string;
  /** Small unit after the number, e.g. `bpm` or `kcal`. */
  unit?: string;
  size?: keyof typeof SIZES;
  color?: string;
  unitColor?: string;
}

/** Big tabular number with a small unit on the same baseline. */
export function Metric({ value, unit, size = 'lg', color, unitColor }: MetricProps) {
  const colors = useColors();
  const scale = SIZES[size];
  return (
    <Text
      style={[
        styles.value,
        { fontSize: scale.value, lineHeight: scale.line, letterSpacing: scale.tracking, color: color ?? colors.foreground },
      ]}>
      {value}
      {unit ? (
        <Text style={[styles.unit, { fontSize: scale.unit, color: unitColor ?? colors.mutedForeground }]}>
          {' '}
          {unit}
        </Text>
      ) : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  value: { fontFamily: fonts.heavy, fontVariant: ['tabular-nums'] },
  unit: { fontFamily: fonts.medium, letterSpacing: 0 },
});
