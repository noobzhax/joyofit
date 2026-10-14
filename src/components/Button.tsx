import type { ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/PressableScale';
import { fontSize, fonts, HIT, radius, spacing, useColors } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** `inverse` is the light button for the dark watch panel. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'inverse';
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  icon,
  style,
}: ButtonProps) {
  const colors = useColors();
  const inactive = disabled || loading;
  const scheme = {
    primary: { bg: colors.primary, fg: colors.primaryForeground },
    secondary: { bg: colors.muted, fg: colors.foreground },
    ghost: { bg: 'transparent', fg: colors.primary },
    destructive: { bg: colors.destructiveSoft, fg: colors.destructive },
    inverse: { bg: colors.heroForeground, fg: colors.hero },
  }[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.base, { backgroundColor: scheme.bg }, style]}>
      {loading ? <ActivityIndicator size="small" color={scheme.fg} /> : null}
      {!loading && icon ? <Ionicons name={icon} size={18} color={scheme.fg} /> : null}
      <Text style={[styles.label, { color: scheme.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: HIT,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: { fontFamily: fonts.medium, fontSize: fontSize.base },
});
