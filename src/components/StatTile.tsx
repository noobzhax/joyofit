import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { radius, spacing, tintColors, useColors, type Tint } from '@/theme';

interface StatTileProps {
  icon: IconName;
  tint: Tint;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}

/** Soft-tinted tile for one number: chip, label, big value with a small unit. */
export function StatTile({ icon, tint, label, value, unit, sub }: StatTileProps) {
  const colors = useColors();
  const scheme = tintColors(colors, tint);
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
      style={[styles.tile, { backgroundColor: scheme.soft }]}>
      <IconChip icon={icon} tint={tint} size="sm" background={colors.card} />
      <View style={styles.body}>
        <AppText variant="label" color={scheme.text}>
          {label}
        </AppText>
        <Metric value={value} unit={unit} size="md" color={scheme.text} unitColor={scheme.text} />
        {sub ? (
          <AppText variant="caption" color={scheme.text}>
            {sub}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: radius.tile, padding: spacing.md + 4, gap: spacing.sm, minHeight: 112 },
  body: { gap: 2 },
});
