/**
 * Calorie intake, body metrics and activity-ring goals (DataSync service 0x37). UNVERIFIED on the watch: the layouts come from
 * Huawei Health 17.0.8.300 static analysis. Native code: `DietSync.kt`, `BodyMetrics.kt`, `ActivityGoals.kt`.
 */

/**
 * Huawei's meal slots: 10 breakfast, 20 lunch, 30 dinner, 40 other. 11 / 21 / 31 are extra breakfast / lunch / dinner slots that
 * only reach the watch when it reports ExpandCapability 215; otherwise they are folded into 40.
 */
export type WhichMeal = 10 | 11 | 20 | 21 | 30 | 31 | 40;

export interface DietMeal {
  /** Stable id; a watch quick-logged meal keeps the id native gave it. Optional for meals from JS. */
  id?: string;
  /** Unix **seconds**. */
  eatTime: number;
  kcal: number;
  whichMeal: WhichMeal;
  /** Grams; the watch gets the day's sums as `dietaryAnalysis`. */
  carbs?: number;
  protein?: number;
  fat?: number;
}

export interface DietGoals {
  /** The day's kcal goal: the recommended range of each slot is a share of it. */
  dailyKcal: number;
  /** Planned daily kcal deficit (`caloricDeficitGoal`); 0 when maintaining. */
  deficitKcal?: number;
  /** Starting weight in kg (`weightInit`); the stored profile weight when absent. */
  weightInitKg?: number;
  /** Goal weight in kg; sends config 900300022 when set. */
  targetWeightKg?: number;
  /** 0 maintain, 1 lose, 2 gain. */
  weightManagerType?: 0 | 1 | 2;
  /** Daily active kcal goal; the activity-ring calories goal when absent. */
  activityCalGoal?: number;
}

export interface DietDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  meals: DietMeal[];
  goals?: DietGoals;
}

/** A meal the watch quick-logged (`onWatchMealLogged`). It is stored natively and kept until `markWatchMealsSynced`. */
export interface WatchLoggedMeal {
  id: string;
  eatTime: number;
  kcal: number;
  whichMeal: number;
  carbs: number | null;
  protein: number | null;
  fat: number | null;
  src: 'watch';
  synced: false;
}

export interface WatchMealLoggedEvent {
  /** Local day of the first meal. */
  date: string;
  meals: WatchLoggedMeal[];
}

export interface DietStatus {
  date: string | null;
  mealCount: number | null;
  intakeKcal: number | null;
  goals: Required<Pick<DietGoals, 'dailyKcal'>> & Partial<DietGoals> | null;
  /** Unix ms of the last `setDietDay`. */
  updatedAt: number | null;
  /** Unix ms of the last push the watch link accepted. */
  pushedAt: number | null;
  /** `sent (set)`, `failed (connected), see the log`, `watch not connected` ... */
  lastResult: string | null;
  /** Watch-logged meals JS has not yet confirmed with `markWatchMealsSynced`. */
  unsyncedWatchMeals: number | null;
  /** The meals behind `unsyncedWatchMeals` (recent days): write them to JoyoRogo, then `markWatchMealsSynced` their ids. */
  pendingWatchMeals: WatchLoggedMeal[] | null;
  /** What the connected watch's ExpandCapability allows; null when no watch is connected. */
  supported: {
    config: boolean;
    event: boolean;
    point: boolean;
    dictionary: boolean;
    extraMealSlots: boolean;
  } | null;
}

/** Only the fields that are set are stored. Times are Unix milliseconds. */
export interface BodyMetricsUpdate {
  weightKg?: number;
  weightTs?: number;
  bodyFatPct?: number;
  bodyFatTs?: number;
  /** Resting metabolism (BMR) in kcal per day. */
  restingKcal?: number;
  systolic?: number;
  diastolic?: number;
  bpTs?: number;
}

export interface BodyMetrics {
  weightKg: number | null;
  weightTs: number | null;
  bodyFatPct: number | null;
  bodyFatTs: number | null;
  restingKcal: number | null;
  systolic: number | null;
  diastolic: number | null;
  bpTs: number | null;
}

export interface ActivityGoals {
  steps: number;
  /** Active kcal. */
  calories: number;
  exerciseMinutes: number;
  standHours: number;
  remindStand: boolean;
  remindProgress: boolean;
  remindGoalReached: boolean;
}

export interface ActivityGoalsStatus extends ActivityGoals {
  /** The connected watch reports DataSync config support (ExpandCapability 83); null when none is connected. */
  configSupported: boolean | null;
  /** Unix ms of the last complete send, or null. */
  lastSentAt: number | null;
}
