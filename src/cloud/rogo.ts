import { NotSignedInError } from '@/cloud/api';
import { authClient } from '@/cloud/auth';
import { JOYOROGO_URL } from '@/cloud/config';

/**
 * Minimal client for JoyoRogo's oRPC API (`packages/api` in the joyorogo repo, mounted at `<server>/rpc`).
 *
 * oRPC's RPC wire format, as `RPCLink` speaks it (checked in @orpc/client 1.15): `POST <url>/rpc/<router>/<procedure>` with the
 * JSON body `{"json": <input>}` and the JoyoRogo session cookie in a `Cookie` header (better-auth's expo client keeps it in
 * secure storage); a 2xx answer is `{"json": <output>, "meta": [...]}`, an error is `{"json": {"defined", "code", "status",
 * "message", "data"}}`. `meta` only describes Date / BigInt values and is ignored here: dates arrive as ISO strings.
 * Types below are written by hand to match the procedures used; nothing in JoyoRogo is changed for this.
 */

/** JoyoRogo answered with an oRPC error (or a non-JSON failure). */
export class RogoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

/** `<router>/<procedure>`, for example `food/listByDate`. */
export async function rogoCall<T>(path: string, input: unknown): Promise<T> {
  const cookie = await authClient.getCookie();
  if (!cookie) throw new NotSignedInError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${JOYOROGO_URL}/rpc/${path}`, {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: input }),
      credentials: 'omit',
      signal: controller.signal,
    });
    const text = await response.text();
    let body: { json?: unknown } | null = null;
    try {
      body = text ? (JSON.parse(text) as { json?: unknown }) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const error = (body?.json ?? null) as { code?: unknown; message?: unknown } | null;
      const code = typeof error?.code === 'string' ? error.code : null;
      const message = typeof error?.message === 'string' ? error.message : `JoyoRogo answered ${response.status}.`;
      throw new RogoError(response.status, code, response.status === 401 ? 'The JoyoRogo session was rejected. Sign in again.' : message);
    }
    return body?.json as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Meal values of JoyoRogo's `food_log.meal`. */
export type RogoMeal = 'sarapan' | 'makan_siang' | 'makan_malam' | 'snack';

/** A `food_log` row as `food.listByDate` returns it (only the fields JoyoFit reads). */
export interface RogoFoodItem {
  id: string;
  /** `YYYY-MM-DD`, Jakarta day. */
  date: string;
  meal: RogoMeal;
  name: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** ISO timestamp (a JS Date in JoyoRogo, serialized by oRPC). */
  createdAt: string;
}

export interface RogoFoodDay {
  items: RogoFoodItem[];
  totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
}

/** `profile.myProfile`: the profile row and today's computed targets (`Targets` in packages/api/src/lib/engine.ts). */
export interface RogoMyProfile {
  profile: {
    heightCm: number;
    gender: string;
    startWeightKg: number;
    targetWeightKg: number;
    targetDate: string;
  } | null;
  targets: {
    /** Basal metabolic rate, kcal per day. */
    bmr: number;
    tdee: number;
    /** The daily kcal to eat: the target for the intake card. */
    eatKcal: number;
    /** Planned daily burn through activity, kcal. */
    burnKcal: number;
    /** Planned daily deficit, kcal. */
    deficitKcal: number;
  } | null;
  latestWeightKg: number | null;
}

export interface RogoWeightEntry {
  /** `YYYY-MM-DD`. */
  date: string;
  weightKg: number;
  createdAt: string;
}

/** JoyoFit's readiness word, as `fitness.upsertScores` accepts it. */
export type RogoReadiness = 'Primed' | 'Balanced' | 'Strained' | 'Run down';

/**
 * One day of scores for `fitness.upsertScores`. `date` is `YYYY-MM-DD`; a score that is left out keeps what JoyoRogo has
 * stored for that day. Ranges: recoveryPct 0..100, strain 0..21, sleepPct 0..300.
 */
export interface RogoScoreDay {
  date: string;
  recoveryPct?: number;
  strain?: number;
  sleepPct?: number;
  readiness?: RogoReadiness;
}

/** Procedures JoyoFit calls. */
export const rogo = {
  foodDay: (date: string) => rogoCall<RogoFoodDay>('food/listByDate', { date }),
  myProfile: () => rogoCall<RogoMyProfile>('profile/myProfile', {}),
  /** The newest weigh-in, or null. `weight.history` returns oldest first, so the last entry is the latest. */
  async latestWeighIn(): Promise<RogoWeightEntry | null> {
    const history = await rogoCall<{ entries: RogoWeightEntry[] }>('weight/history', { limit: 1 });
    return history.entries.at(-1) ?? null;
  },
  /** Writes one item to the diary (a meal the watch quick-logged). */
  addFood: (input: { date: string; meal: RogoMeal; name: string; kcal: number }) =>
    rogoCall<RogoFoodItem>('food/add', { ...input, source: 'manual' }),
  /** Stores the day's Recovery / Strain / Sleep for JoyoRogo's diary. JoyoRogo answers 404 until it is deployed with the `fitness` router. */
  pushScores: (days: RogoScoreDay[]) => rogoCall<{ saved: number }>('fitness/upsertScores', { days }),
};
