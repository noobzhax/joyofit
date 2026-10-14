import Constants from 'expo-constants';

interface CloudExtra {
  joyorogoUrl?: string;
  cloudUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as CloudExtra;

const trimSlash = (url: string) => url.trim().replace(/\/+$/, '');

/**
 * JoyoRogo's server origin (better-auth lives under `/api/auth`). Set `EXPO_PUBLIC_JOYOROGO_URL` at build
 * time, or `expo.extra.joyorogoUrl` in app.json; defaults to the production API of the JoyoRogo app.
 */
export const JOYOROGO_URL = trimSlash(
  process.env.EXPO_PUBLIC_JOYOROGO_URL || extra.joyorogoUrl || 'https://api.joyorogo.com',
);

/**
 * Origin of the JoyoFit cloud Worker (`server/`). Empty until you have deployed it: set
 * `EXPO_PUBLIC_JOYOFIT_CLOUD_URL` at build time, or `expo.extra.cloudUrl` in app.json.
 */
export const CLOUD_URL = trimSlash(process.env.EXPO_PUBLIC_JOYOFIT_CLOUD_URL || extra.cloudUrl || '');

export const CLOUD_CONFIGURED = CLOUD_URL !== '';
