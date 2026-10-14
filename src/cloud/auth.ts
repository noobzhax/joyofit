import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { JOYOROGO_URL } from '@/cloud/config';

const scheme = typeof Constants.expoConfig?.scheme === 'string' ? Constants.expoConfig.scheme : 'joyofit';

/**
 * better-auth client for the JoyoRogo account. The session cookies it receives are kept in the
 * Android Keystore-backed `expo-secure-store` (keys `joyofit_cookie` / `joyofit_session_data`) and
 * never leave the JS side: native code (the background service) cannot read them.
 */
export const authClient = createAuthClient({
  baseURL: JOYOROGO_URL,
  plugins: [expoClient({ scheme, storagePrefix: 'joyofit', storage: SecureStore })],
});
