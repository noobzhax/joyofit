import { StyleSheet, Text, type TextProps } from 'react-native';

import { monoFont, usePalette } from '@/theme';

type Variant = 'title' | 'body' | 'caption' | 'mono' | 'figure';

interface AppTextProps extends TextProps {
  variant?: Variant;
  muted?: boolean;
  danger?: boolean;
}

export function AppText({ variant = 'body', muted, danger, style, ...rest }: AppTextProps) {
  const palette = usePalette();
  const color = danger ? palette.danger : muted ? palette.textMuted : palette.text;
  return <Text {...rest} style={[styles[variant], { color }, style]} />;
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  caption: { fontSize: 13, lineHeight: 18 },
  mono: { fontSize: 12, lineHeight: 17, fontFamily: monoFont },
  figure: { fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
