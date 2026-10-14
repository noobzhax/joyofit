import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { tintColors, useColors, type Tint } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

const SIZES = { sm: 32, md: 40, lg: 48 } as const;

interface IconChipProps {
  icon: IconName;
  /** A data color, or neutral for chrome that is not a metric. */
  tint?: Tint | 'neutral';
  size?: keyof typeof SIZES;
  /** Fill behind the glyph; defaults to the tint's soft color. Pass `card` on tinted tiles. */
  background?: string;
}

/** Soft-tinted round chip holding one icon. Decorative: hidden from screen readers. */
export function IconChip({ icon, tint = 'neutral', size = 'md', background }: IconChipProps) {
  const colors = useColors();
  const box = SIZES[size];
  const scheme =
    tint === 'neutral'
      ? { soft: colors.muted, glyph: colors.foreground }
      : { soft: tintColors(colors, tint).soft, glyph: tintColors(colors, tint).text };
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: box,
        height: box,
        borderRadius: box / 2,
        backgroundColor: background ?? scheme.soft,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Ionicons name={icon} size={Math.round(box * 0.5)} color={scheme.glyph} />
    </View>
  );
}
