import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { fontSize, fonts, HIT, radius, spacing, useColors } from '@/theme';

interface InputProps extends TextInputProps {
  /** Leading glyph, e.g. a magnifier for search boxes. */
  icon?: IconName;
}

/** 48 dp borderless input on the muted fill; a primary ring marks focus. */
export function Input({ icon, style, onFocus, onBlur, ...rest }: InputProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.box,
        { backgroundColor: colors.muted, borderColor: focused ? colors.primary : 'transparent' },
      ]}>
      {icon ? <Ionicons name={icon} size={18} color={colors.mutedForeground} /> : null}
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, { color: colors.foreground }, style]}
      />
    </View>
  );
}

interface FieldProps extends InputProps {
  label: string;
  hint?: string;
  children?: ReactNode;
}

/** Label above an Input. The label doubles as the accessibility label. */
export function Field({ label, hint, accessibilityLabel, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      <Input accessibilityLabel={accessibilityLabel ?? label} {...input} />
      {hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  box: {
    minHeight: HIT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.input,
    borderWidth: 2,
  },
  input: { flex: 1, minHeight: HIT, fontFamily: fonts.regular, fontSize: fontSize.base, padding: 0 },
});
