import { Platform, useColorScheme } from 'react-native';

export interface Palette {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  /** The single accent: connected state, primary actions, TX log lines, chart bars. */
  accent: string;
  onAccent: string;
  danger: string;
}

const light: Palette = {
  background: '#F4F3EF',
  surface: '#FFFFFF',
  border: '#D9D7D0',
  text: '#1B1D1C',
  textMuted: '#5F6460',
  accent: '#0B6E5F',
  onAccent: '#FFFFFF',
  danger: '#B3261E',
};

const dark: Palette = {
  background: '#111312',
  surface: '#1B1E1D',
  border: '#303533',
  text: '#ECEDEA',
  textMuted: '#9AA19D',
  accent: '#4FC4AE',
  onAccent: '#08201B',
  danger: '#F2877F',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radius = { sm: 4, md: 8 } as const;

export const monoFont = Platform.select({ android: 'monospace', default: 'Courier' });
