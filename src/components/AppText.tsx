import { StyleSheet, Text, type TextProps } from 'react-native';

import { fontSize, fonts, monoFont, useColors } from '@/theme';

type Variant =
  | 'display'
  | 'figure'
  | 'title'
  | 'heading'
  | 'bodyStrong'
  | 'body'
  | 'caption'
  | 'label'
  | 'mono';

interface AppTextProps extends TextProps {
  variant?: Variant;
  muted?: boolean;
  danger?: boolean;
  /** Overrides the color the other flags pick; used on tinted and hero surfaces. */
  color?: string;
}

export function AppText({ variant = 'body', muted, danger, color, style, ...rest }: AppTextProps) {
  const colors = useColors();
  const resolved =
    color ?? (danger ? colors.destructive : muted ? colors.mutedForeground : colors.foreground);
  return <Text {...rest} style={[styles[variant], { color: resolved }, style]} />;
}

const styles = StyleSheet.create({
  display: {
    fontFamily: fonts.heavy,
    fontSize: fontSize.hero,
    lineHeight: 60,
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  figure: {
    fontFamily: fonts.heavy,
    fontSize: fontSize.figure,
    lineHeight: 38,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  title: { fontFamily: fonts.heavy, fontSize: fontSize.title, lineHeight: 34, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.bold, fontSize: fontSize.md, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: fontSize.base, lineHeight: 21 },
  body: { fontFamily: fonts.regular, fontSize: fontSize.base, lineHeight: 22 },
  caption: { fontFamily: fonts.regular, fontSize: fontSize.sm, lineHeight: 19 },
  label: { fontFamily: fonts.medium, fontSize: fontSize.sm, lineHeight: 18 },
  mono: { fontFamily: monoFont, fontSize: fontSize.xs, lineHeight: 17 },
});
