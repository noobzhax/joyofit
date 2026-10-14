import { useEventListener } from 'expo';
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
import { rogo } from '@/cloud/rogo';
import { bodyMetricsFrom, buildDay, localDate, rogoMealFor } from '@/features/meals/mealMap';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type DietStatus, type LogDirection } from '@/wear';

/** Wait this long after a watch sync (or a burst of triggers) so they become one refresh. */
const REFRESH_DEBOUNCE_MS = 2_000;

/** Lines in the Log screen next to the native ones. */
const log = (direction: LogDirection, message: string) =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message });

export interface MealsContextValue {
  /** A JoyoRogo session exists; without it nothing is fetched and the watch keeps the last day it was given. */
  signedIn: boolean;
  refreshing: boolean;
  /** Last refresh failure (network, session, JoyoRogo); cleared by the next success. */
  error: string | null;
  /** Unix ms of the last refresh that read JoyoRogo and stored the day. */
  lastRefreshAt: number | null;
  /** One line on what that refresh found, for example `4 meals, 1240 of 1800 kcal`. */
  lastRefreshNote: string | null;
  /** What native code reports: last push, result, watch support, meals awaiting JoyoRogo. */
  diet: DietStatus;
  /** Reads today's diary, goals and weigh-in from JoyoRogo, stores them and pushes them to a connected watch. */
  refresh: (reason: string) => Promise<void>;
  /** Fetches and pushes now; without a session it only sends the stored day again. */
  pushNow: () => Promise<void>;
  /** Re-reads the native status (after the watch pushed or asked). */
  reloadStatus: () => void;
}

const MealsContext = createContext<MealsContextValue | null>(null);

export function useMeals(): MealsContextValue {
  const value = useContext(MealsContext);
  if (!value) throw new Error('useMeals must be used inside <MealsProvider>');
  return value;
}

/**
 * Feeds the watch's calorie card from JoyoRogo. The session cookies live in expo-secure-store and are read from JS only, so
 * this runs in the app: on the first render with a session, when the app returns to the foreground, after each watch sync, when
 * the watch connects, when the watch quick-logs a meal and on "Push now". While the app is closed the background service
 * answers the watch from the last day stored here (native `diet_day`) and rolls it over to an empty new day.
 */
export function MealsProvider({ children }: { children: ReactNode }) {
  const { dataVersion, linkState } = useWatch();
  const session = authClient.useSession();
  const signedIn = session.data?.user != null;

  const [diet, setDiet] = useState<DietStatus>(() => HuaweiWear.getDietStatus());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [lastRefreshNote, setLastRefreshNote] = useState<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef<string | null>(null);

  const reloadStatus = useCallback(() => setDiet(HuaweiWear.getDietStatus()), []);

  /** One pass: meals the watch logged go to JoyoRogo first, then today's diary, goals and weigh-in come back. */
  const pass = useCallback(
    async (reason: string) => {
      const notes: string[] = [];
      const pending = HuaweiWear.getDietStatus().pendingWatchMeals ?? [];
      const written: string[] = [];
      for (const meal of pending) {
        try {
          await rogo.addFood({
            date: localDate(meal.eatTime * 1000),
            meal: rogoMealFor(meal.whichMeal),
            name: 'Logged on the watch',
            kcal: Math.round(meal.kcal),
          });
          written.push(meal.id);
        } catch (e) {
          notes.push(`a watch meal could not be written to JoyoRogo: ${errorMessage(e)}`);
          log('error', `Meals: watch meal ${meal.id} not written to JoyoRogo: ${errorMessage(e)}`);
        }
      }
      if (written.length > 0) {
        await HuaweiWear.markWatchMealsSynced(written);
        log('info', `Meals: ${written.length} watch meal(s) written to JoyoRogo`);
      }

      const date = localDate();
      const [food, my, weighIn] = await Promise.allSettled([rogo.foodDay(date), rogo.myProfile(), rogo.latestWeighIn()]);
      if (food.status === 'rejected') throw food.reason;
      const profile = my.status === 'fulfilled' ? my.value : null;
      if (my.status === 'rejected') notes.push(`goals not read: ${errorMessage(my.reason)}`);
      const latest = weighIn.status === 'fulfilled' ? weighIn.value : null;

      const body = bodyMetricsFrom(profile, latest);
      if (Object.keys(body).length > 0) await HuaweiWear.setBodyMetrics(body);

      const day = buildDay(date, food.value.items, profile);
      const sent = await HuaweiWear.setDietDay(day);
      const kcal = Math.round(day.meals.reduce((sum, m) => sum + m.kcal, 0));
      const note = `${day.meals.length} meal${day.meals.length === 1 ? '' : 's'}, ${kcal}${day.goals ? ` of ${day.goals.dailyKcal}` : ''} kcal${sent ? ', sent to the watch' : ', stored for the watch'}`;
      log('info', `Meals (${reason}): ${note}`);
      setLastRefreshAt(Date.now());
      setLastRefreshNote(notes.length > 0 ? `${note}; ${notes.join('; ')}` : note);
    },
    [],
  );

  const refresh = useCallback(
    (reason: string): Promise<void> => {
      if (!signedIn) return Promise.resolve();
      if (running.current) {
        again.current = reason;
        return running.current;
      }
      const run = (async () => {
        setRefreshing(true);
        setError(null);
        try {
          let next: string | null = reason;
          while (next !== null) {
            again.current = null;
            await pass(next);
            next = again.current;
          }
        } catch (e) {
          setError(errorMessage(e));
          log('error', `Meals (${reason}): ${errorMessage(e)}`);
        } finally {
          setRefreshing(false);
          running.current = null;
          reloadStatus();
        }
      })();
      running.current = run;
      return run;
    },
    [signedIn, pass, reloadStatus],
  );

  const pushNow = useCallback(async () => {
    if (signedIn) {
      await refresh('manual');
      return;
    }
    try {
      await HuaweiWear.pushDietNow();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      reloadStatus();
    }
  }, [signedIn, refresh, reloadStatus]);

  // First render with a session, and after every local sync (the watch may have logged meals; the diary may have changed).
  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(() => void refresh('sync'), REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signedIn, dataVersion, refresh]);

  // The watch just connected: push even if nothing changed (native also pushes its stored day on connect).
  useEffect(() => {
    if (signedIn && linkState === 'connected') void refresh('connected');
  }, [signedIn, linkState, refresh]);

  useEffect(() => {
    if (!signedIn) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh('foreground');
    });
    return () => subscription.remove();
  }, [signedIn, refresh]);

  // The watch quick-logged a meal: native stored it; write it to JoyoRogo and read the diary back.
  useEventListener(HuaweiWear, 'onWatchMealLogged', () => {
    reloadStatus();
    void refresh('watch meal');
  });

  const value = useMemo<MealsContextValue>(
    () => ({ signedIn, refreshing, error, lastRefreshAt, lastRefreshNote, diet, refresh, pushNow, reloadStatus }),
    [signedIn, refreshing, error, lastRefreshAt, lastRefreshNote, diet, refresh, pushNow, reloadStatus],
  );
  return <MealsContext.Provider value={value}>{children}</MealsContext.Provider>;
}
