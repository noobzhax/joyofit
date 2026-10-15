import type { RogoScoreDay } from '@/cloud/rogo';
import { localDate } from '@/features/meals/mealMap';
import type { Scores } from '@/features/today/scores';

/** Today and the days before it that are sent, so a day whose strain grew after the last push is corrected. */
export const ROGO_SCORE_DAYS = 3;

/**
 * The scores JoyoRogo gets, oldest first. Earlier days carry strain only: recovery, sleep and the readiness word are
 * computed for today and are not recomputed for past days, and JoyoRogo keeps what it already stored for them. Days are
 * the phone's calendar days, the same key the meals sync uses; for Indonesian time zones that is JoyoRogo's WIB day.
 * Values are rounded as the Today card shows them. Empty when there is nothing to send.
 */
export function rogoScoreDays(scores: Scores, dayStart: number): RogoScoreDay[] {
  const days: RogoScoreDay[] = [];
  for (const entry of scores.strain) {
    if (entry.day >= dayStart || entry.day <= dayStart - ROGO_SCORE_DAYS * 86400) continue;
    days.push({ date: localDate(entry.day * 1000), strain: roundStrain(entry.strain) });
  }

  const sleep = scores.readiness.signals.find((s) => s.key === 'sleep');
  const today: RogoScoreDay = { date: localDate(dayStart * 1000) };
  if (scores.today) today.strain = roundStrain(scores.today.strain);
  if (scores.readiness.recovery) today.recoveryPct = scores.readiness.recovery.percent;
  if (sleep) today.sleepPct = Math.min(300, Math.max(0, Math.round(sleep.amount * 100)));
  if (scores.readiness.headline) today.readiness = scores.readiness.headline;
  if (Object.keys(today).length > 1) days.push(today);

  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function roundStrain(strain: number): number {
  return Math.min(21, Math.max(0, Math.round(strain * 10) / 10));
}
