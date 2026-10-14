import { Platform, useColorScheme } from 'react-native';

/**
 * JoyoFit design tokens. Same family as JoyoRogo design v2: warm paper canvas, borderless white
 * cards with large radii, Plus Jakarta Sans, one primary plus data colors that only tell metrics
 * apart, each with a soft tint (chip and tile backgrounds) and a darker `*Text` shade that passes AA
 * on that tint.
 *
 * The twist is the device feel:
 * - Primary is an ink teal (#0A6580), not JoyoRogo's leaf green. It reads as the glass of a watch
 *   next to JoyoRogo's food green and doubles as the steps color, the way green is "makan" there.
 * - Sleep stays indigo (#5C69BC, JoyoRogo's "tidur") so the same metric has the same color in both apps.
 * - Heart is rose, workouts amber, link/battery green. Status green is a state color, so it is not
 *   JoyoRogo's brand green either.
 * - The watch hero is an ink "screen" panel in both themes (`hero*`), the one place that is dark in
 *   light mode, so the live numbers read like a watch face.
 *
 * Contrast (checked by script): every `*Text` on its `*Soft` and on `card` is >= 4.5; base data
 * colors on `card` are >= 3.7 (non-text 3:1); `mutedForeground` is >= 5.0 on background, card, muted;
 * hero text is >= 7.2 on `hero`.
 */

export type Tint = 'steps' | 'heart' | 'sleep' | 'workouts' | 'link';

const lightColors = {
  background: '#F9F6F1',
  card: '#FFFFFF',
  foreground: '#1D1A15',
  muted: '#F0ECE5',
  mutedForeground: '#66635C',
  hairline: 'rgba(29,26,21,0.10)',
  primary: '#0A6580',
  primaryForeground: '#FFFFFF',
  destructive: '#B42318',
  destructiveSoft: '#FDE7E4',
  warning: '#B45309',
  switchOff: '#D6D0C6',
  steps: '#0A6580',
  stepsSoft: '#DCF0F6',
  stepsText: '#07506A',
  heart: '#D12F4D',
  heartSoft: '#FFE4E9',
  heartText: '#A31E39',
  sleep: '#5C69BC',
  sleepSoft: '#E8EDFF',
  sleepText: '#424B8E',
  workouts: '#C2700A',
  workoutsSoft: '#FFEFD6',
  workoutsText: '#8A4E00',
  link: '#177A45',
  linkSoft: '#DFF5E6',
  linkText: '#0F6236',
  stageDeep: '#3F4A9A',
  stageRem: '#8A6BD4',
  stageLight: '#A9B3EA',
  stageAwake: '#E2A03A',
  hero: '#0F2F3A',
  heroForeground: '#F2F7F8',
  heroMuted: '#A9C2C9',
  heroTrack: '#24505E',
  heroDivider: 'rgba(242,247,248,0.14)',
  heroSteps: '#5FD3EE',
  heroHeart: '#FF8FA4',
  heroLink: '#6EE7A0',
  heroWarn: '#F5B35A',
};

export type Colors = { [K in keyof typeof lightColors]: string };

const darkColors: Colors = {
  background: '#0D1112',
  card: '#171D1F',
  foreground: '#EEF1F0',
  muted: '#242C2F',
  mutedForeground: '#9BA6A8',
  hairline: 'rgba(238,241,240,0.10)',
  primary: '#58C4DE',
  primaryForeground: '#04222B',
  destructive: '#FF8A80',
  destructiveSoft: '#41201E',
  warning: '#F0A23C',
  switchOff: '#3A4346',
  steps: '#58C4DE',
  stepsSoft: '#12323C',
  stepsText: '#58C4DE',
  heart: '#FF7B93',
  heartSoft: '#42202B',
  heartText: '#FF8FA4',
  sleep: '#8F9BE3',
  sleepSoft: '#262C4A',
  sleepText: '#9AA5E8',
  workouts: '#F0A23C',
  workoutsSoft: '#41300F',
  workoutsText: '#F0A23C',
  link: '#5FD08D',
  linkSoft: '#123324',
  linkText: '#5FD08D',
  stageDeep: '#4B57B5',
  stageRem: '#C09CF5',
  stageLight: '#8F9BE3',
  stageAwake: '#F0A23C',
  hero: '#10303B',
  heroForeground: '#F2F7F8',
  heroMuted: '#A9C2C9',
  heroTrack: '#24505E',
  heroDivider: 'rgba(242,247,248,0.14)',
  heroSteps: '#5FD3EE',
  heroHeart: '#FF8FA4',
  heroLink: '#6EE7A0',
  heroWarn: '#F5B35A',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? darkColors : lightColors;
}

/** Base (icons, chart fills), soft (chip and tile background) and text (AA on soft) of one data color. */
export function tintColors(colors: Colors, tint: Tint): { base: string; soft: string; text: string } {
  return {
    base: colors[tint],
    soft: colors[`${tint}Soft`],
    text: colors[`${tint}Text`],
  };
}

/** Page padding 20, related cards 12 apart, sections 28 apart, card padding 20. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 } as const;

export const radius = { card: 24, tile: 18, input: 14, pill: 999 } as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  title: 28,
  figure: 32,
  hero: 56,
} as const;

/** Loaded in the root layout. Android has no weight axis for custom fonts, so each weight is a family. */
export const fonts = {
  regular: 'PlusJakartaSans_500Medium',
  medium: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  heavy: 'PlusJakartaSans_800ExtraBold',
} as const;

export const monoFont = Platform.select({ android: 'monospace', default: 'Courier' });

/** Smallest touch target, in dp. */
export const HIT = 48;
