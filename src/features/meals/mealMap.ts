import type { RogoFoodItem, RogoMeal, RogoMyProfile, RogoWeightEntry } from '@/cloud/rogo';
import type { BodyMetricsUpdate, DietDay, DietGoals, DietMeal, WhichMeal } from '@/wear';

/** Items of one meal logged this far after the first one go to the watch's extra slot (11 / 21 / 31) when the watch has it. */
export const EXTRA_SLOT_GAP_MS = 3 * 60 * 60 * 1000;

const BASE_SLOT: Record<RogoMeal, WhichMeal> = {
  sarapan: 10,
  makan_siang: 20,
  makan_malam: 30,
  snack: 40,
};

/** Extra breakfast / lunch / dinner. Snack has none. The watch folds these into 40 when ExpandCapability 215 is not set. */
const EXTRA_SLOT: Record<RogoMeal, WhichMeal | null> = {
  sarapan: 11,
  makan_siang: 21,
  makan_malam: 31,
  snack: null,
};

const REVERSE: Record<number, RogoMeal> = {
  10: 'sarapan',
  11: 'sarapan',
  20: 'makan_siang',
  21: 'makan_siang',
  30: 'makan_malam',
  31: 'makan_malam',
  40: 'snack',
};

/** JoyoRogo's meal for a Huawei slot; anything unknown is a snack. */
export function rogoMealFor(whichMeal: number): RogoMeal {
  return REVERSE[whichMeal] ?? 'snack';
}

/** The phone's local `YYYY-MM-DD`. */
export function localDate(ms: number = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local noon of a `YYYY-MM-DD`, in ms. */
function noonOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

/** When the item was eaten: its log time when that is on the day, else (a back-filled entry) noon of the day. */
function eatTimeMs(item: RogoFoodItem, date: string): number {
  const created = Date.parse(item.createdAt);
  if (Number.isFinite(created) && localDate(created) === date) return created;
  return noonOf(date);
}

/**
 * Meals of a JoyoRogo day as Huawei slots: sarapan 10, makan siang 20, makan malam 30, snack 40. Per meal, an item logged 3 h
 * or more after the first item of that meal goes to the extra slot (11 / 21 / 31) instead; native code keeps those only when the
 * watch reports ExpandCapability 215 and folds them into 40 otherwise.
 */
export function mapMeals(date: string, items: readonly RogoFoodItem[]): DietMeal[] {
  const firstOf = new Map<RogoMeal, number>();
  const sorted = items
    .map((item) => ({ item, at: eatTimeMs(item, date) }))
    .sort((a, b) => a.at - b.at);
  const out: DietMeal[] = [];
  for (const { item, at } of sorted) {
    const first = firstOf.get(item.meal);
    if (first === undefined) firstOf.set(item.meal, at);
    const extra = EXTRA_SLOT[item.meal];
    const useExtra = first !== undefined && extra !== null && at - first >= EXTRA_SLOT_GAP_MS;
    out.push({
      id: `rogo-${item.id}`,
      eatTime: Math.floor(at / 1000),
      kcal: item.kcal,
      whichMeal: useExtra ? extra : BASE_SLOT[item.meal],
      ...(item.carbs != null ? { carbs: item.carbs } : {}),
      ...(item.protein != null ? { protein: item.protein } : {}),
      ...(item.fat != null ? { fat: item.fat } : {}),
    });
  }
  return out;
}

/** 0 maintain, 1 lose, 2 gain, from the goal weight against the latest weight (0.5 kg tolerance). */
export function weightManagerType(targetKg: number | null | undefined, weightKg: number | null | undefined): 0 | 1 | 2 {
  if (targetKg == null || weightKg == null) return 0;
  if (targetKg < weightKg - 0.5) return 1;
  if (targetKg > weightKg + 0.5) return 2;
  return 0;
}

/** The day's goals from `profile.myProfile`; undefined when JoyoRogo has no plan yet (no onboarding). */
export function mapGoals(my: RogoMyProfile): DietGoals | undefined {
  if (!my.targets || !my.profile || !(my.targets.eatKcal > 0)) return undefined;
  const burn = Math.round(my.targets.burnKcal);
  return {
    dailyKcal: Math.round(my.targets.eatKcal),
    deficitKcal: Math.max(0, Math.round(my.targets.deficitKcal)),
    weightInitKg: my.profile.startWeightKg,
    targetWeightKg: my.profile.targetWeightKg,
    weightManagerType: weightManagerType(my.profile.targetWeightKg, my.latestWeightKg),
    ...(burn > 0 ? { activityCalGoal: burn } : {}),
  };
}

export function buildDay(date: string, items: readonly RogoFoodItem[], my: RogoMyProfile | null): DietDay {
  const goals = my ? mapGoals(my) : undefined;
  return { date, meals: mapMeals(date, items), ...(goals ? { goals } : {}) };
}

/**
 * What the watch can use of the JoyoRogo profile: the BMR as resting metabolism, the latest weigh-in as weight. JoyoRogo stores no
 * body fat and no blood pressure, so those fields stay unset (the watch keeps whatever it had, and omits them on the Health Glance).
 */
export function bodyMetricsFrom(my: RogoMyProfile | null, weighIn: RogoWeightEntry | null): BodyMetricsUpdate {
  const update: BodyMetricsUpdate = {};
  const weight = weighIn?.weightKg ?? my?.latestWeightKg ?? null;
  if (weight != null) update.weightKg = weight;
  if (weighIn) {
    const ts = Date.parse(weighIn.createdAt);
    update.weightTs = Number.isFinite(ts) ? ts : noonOf(weighIn.date);
  }
  const bmr = my?.targets?.bmr;
  if (bmr != null && bmr > 0) update.restingKcal = Math.round(bmr);
  return update;
}
