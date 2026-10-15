import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { formatGrams } from '@/features/live/liveWorkout';
import { spacing, useColors } from '@/theme';

/** One big gram figure: `Fat 12.4 g`. */
export function BurnFigure({ label, grams, color }: { label: string; grams: number; color: string }) {
  return (
    <View style={styles.figure} accessible accessibilityLabel={`${label} ${formatGrams(grams)} grams`}>
      <AppText variant="label" color={color}>
        {label}
      </AppText>
      <Metric value={formatGrams(grams)} unit="g" size="lg" color={color} unitColor={color} />
    </View>
  );
}

/** The fat and carbohydrate shares of the energy, as a bar and a sentence that starts with `lead`. */
export function FuelBar({ fatShare, lead }: { fatShare: number | null; lead: string }) {
  const colors = useColors();
  if (fatShare === null) return null;
  const fatPct = Math.round(fatShare * 100);
  return (
    <View style={styles.fuel}>
      <View style={[styles.track, { backgroundColor: colors.stepsSoft }]}>
        <View style={[styles.fat, { width: `${fatPct}%`, backgroundColor: colors.workouts }]} />
      </View>
      <AppText variant="caption" muted>
        {lead} {fatPct}% from fat, {100 - fatPct}% from carbs
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  figure: { flex: 1, gap: 2 },
  fuel: { gap: spacing.xs },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fat: { height: '100%' },
});
