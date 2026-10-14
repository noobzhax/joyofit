import { fonts, useColors } from '@/theme';

/**
 * Shared options for the nested stacks. Pushed screens get a flat native header in the paper color
 * with a bold Plus Jakarta title; tab-root screens turn the header off and draw their own title.
 */
export function useStackOptions() {
  const colors = useColors();
  return {
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.foreground,
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18, color: colors.foreground },
    contentStyle: { backgroundColor: colors.background },
  } as const;
}
