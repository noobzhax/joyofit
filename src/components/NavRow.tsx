import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { radius, spacing, useColors, type Colors, type Tint } from '@/theme';

interface NavRowProps {
  icon: IconName;
  tint?: Tint | 'neutral';
  title: string;
  subtitle?: string;
  /** Short value shown before the chevron, e.g. a count. */
  value?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Frame inside a grouped list (see `groupedRowStyle`). */
  style?: ViewStyle;
}

/** Tappable row: icon chip, title with an optional line under it, chevron. 64 dp so it is easy to hit. */
export function NavRow({ icon, tint, title, subtitle, value, onPress, disabled, style }: NavRowProps) {
  const colors = useColors();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.985}
      style={[styles.row, style]}>
      <IconChip icon={icon} tint={tint} size="md" />
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" muted numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="caption" muted>
          {value}
        </AppText>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
    </PressableScale>
  );
}

/**
 * Frame for one row of a grouped list: white card, hairline between rows, the first and last rows
 * carry the card's rounded corners. Lets virtualized lists (rows are separate items) read as one card.
 */
export function groupedRowStyle(colors: Colors, index: number, count: number): ViewStyle {
  return {
    backgroundColor: colors.card,
    borderTopLeftRadius: index === 0 ? radius.card : 0,
    borderTopRightRadius: index === 0 ? radius.card : 0,
    borderBottomLeftRadius: index === count - 1 ? radius.card : 0,
    borderBottomRightRadius: index === count - 1 ? radius.card : 0,
    borderBottomWidth: index < count - 1 ? StyleSheet.hairlineWidth : 0,
    borderBottomColor: colors.hairline,
  };
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1, gap: 1 },
});
