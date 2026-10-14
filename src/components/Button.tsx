import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { radius, usePalette } from '@/theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}

export function Button({ label, onPress, variant = 'secondary', disabled, loading }: ButtonProps) {
  const palette = usePalette();
  const inactive = disabled || loading;
  const filled = variant === 'primary';
  const tint = variant === 'danger' ? palette.danger : filled ? palette.onAccent : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: filled ? palette.accent : 'transparent',
          borderColor: filled ? palette.accent : variant === 'danger' ? palette.danger : palette.border,
          opacity: inactive ? 0.45 : pressed ? 0.75 : 1,
        },
      ]}>
      {loading ? <ActivityIndicator size="small" color={tint} /> : null}
      <Text style={[styles.label, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: { fontSize: 15, fontWeight: '600' },
});
