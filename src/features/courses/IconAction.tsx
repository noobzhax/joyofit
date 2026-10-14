import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { HIT, useColors } from '@/theme';

interface IconActionProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** Glyph-only button with a 48 dp hit area; `label` is what a screen reader says. */
export function IconAction({ icon, label, onPress, disabled, danger }: IconActionProps) {
  const colors = useColors();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.hit}>
      <Ionicons name={icon} size={20} color={danger ? colors.destructive : colors.foreground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hit: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
});
