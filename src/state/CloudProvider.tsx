import * as Linking from 'expo-linking';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { authClient } from '@/cloud/auth';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import { runUpload } from '@/cloud/uploader';
import { countPending, getCloudState, type CloudState } from '@/db/cloud';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';

/** Wait this long after a local sync (or app start) so bursts of events become one upload. */
const UPLOAD_DEBOUNCE_MS = 2_000;

export interface CloudContextValue {
  /** The cloud server URL is set in this build. */
  configured: boolean;
  signedIn: boolean;
  /** The session is still being read from secure storage. */
  sessionPending: boolean;
  /** JoyoRogo account email, from the session or the last upload. */
  email: string | null;
  uploading: boolean;
  /** Last sign-in or upload failure. */
  error: string | null;
  /** Unix seconds of the last finished upload. */
  lastSyncAt: number | null;
  /** Rows stored on the phone that the cloud does not have yet. */
  pending: number | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const CloudContext = createContext<CloudContextValue | null>(null);

export function useCloud(): CloudContextValue {
  const value = useContext(CloudContext);
  if (!value) throw new Error('useCloud must be used inside <CloudProvider>');
  return value;
}

/**
 * JoyoRogo sign-in plus the upload of the local database to the JoyoFit cloud Worker. An upload runs
 * after every local sync the app sees (`dataVersion`), when the app comes to the foreground, and on
 * "Sync now". Rows the background service stored while the app was closed go up on the next of those.
 * Uploads never overlap: a request made during one is served by one more run right after it.
 */
export function CloudProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { dataVersion } = useWatch();
  const session = authClient.useSession();
  const signedIn = session.data?.user != null;

  const [stored, setStored] = useState<CloudState | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const load = useCallback(
    () => Promise.all([getCloudState(db), countPending(db)]),
    [db],
  );

  const refresh = useCallback(async () => {
    const [state, count] = await load();
    setStored(state);
    setPending(count);
  }, [load]);

  // Re-read after every local sync: new rows may be waiting.
  useEffect(() => {
    let live = true;
    load().then(
      ([state, count]) => {
        if (!live) return;
        setStored(state);
        setPending(count);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [load, dataVersion]);

  const syncNow = useCallback((): Promise<void> => {
    if (!CLOUD_CONFIGURED) {
      setError('The cloud server URL is not set in this build.');
      return Promise.resolve();
    }
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      setUploading(true);
      setError(null);
      try {
        do {
          again.current = false;
          await runUpload(db);
        } while (again.current);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setUploading(false);
        running.current = null;
        await refresh().catch(() => {});
      }
    })();
    running.current = run;
    return run;
  }, [db, refresh]);

  // Upload after each local sync, and once at start, as soon as there is a session.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED) return;
    const timer = setTimeout(() => void syncNow(), UPLOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signedIn, dataVersion, syncNow]);

  // Rows from the background service arrive while the app is closed; pick them up on return.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    return () => subscription.remove();
  }, [signedIn, syncNow]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: Linking.createURL('/') });
      if (result.error) setError(result.error.message ?? 'Sign-in failed.');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await authClient.signOut();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const value = useMemo<CloudContextValue>(
    () => ({
      configured: CLOUD_CONFIGURED,
      signedIn,
      sessionPending: session.isPending,
      email: session.data?.user.email ?? stored?.email ?? null,
      uploading,
      error: error ?? stored?.lastError ?? null,
      lastSyncAt: stored?.lastSyncAt ?? null,
      pending,
      signIn,
      signOut,
      syncNow,
    }),
    [signedIn, session.isPending, session.data, stored, uploading, error, pending, signIn, signOut, syncNow],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}
