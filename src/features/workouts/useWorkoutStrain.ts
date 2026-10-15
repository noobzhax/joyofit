import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { listWorkoutPoints, type WorkoutRow } from '@/db/queries';
import { workoutStrain } from '@/features/today/strain';
import { DEFAULT_AGE, maxHeartRate } from '@/features/workouts/substrate';
import { HuaweiWear } from '@/wear';

/** Maximum heart rate from the saved profile's birth year, or from the default age when there is none. */
export function userMaxHr(): number {
  const birthYear = HuaweiWear.getUserProfile()?.birthYear;
  return maxHeartRate(birthYear ? new Date().getFullYear() - birthYear : DEFAULT_AGE);
}

/** Strain per workout, so scrolling a card back into view does not read its points again. A finished download never changes. */
const cache = new Map<string, number | null>();

/**
 * Strain (0..21) of one workout from its stored heart-rate samples. Undefined while loading, null when the workout has
 * no heart-rate samples to work from.
 */
export function useWorkoutStrain(workout: WorkoutRow): number | null | undefined {
  const db = useSQLiteContext();
  const maxHr = userMaxHr();
  const key = `${workout.id}:${workout.complete ? 1 : 0}:${workout.end}:${maxHr}`;
  const [state, setState] = useState<{ key: string; strain: number | null } | null>(null);
  const cached = cache.get(key);

  useEffect(() => {
    if (cache.has(key)) return;
    let cancelled = false;
    listWorkoutPoints(db, workout.id).then(
      (points) => {
        const strain = workoutStrain(points, maxHr)?.strain ?? null;
        if (workout.complete) cache.set(key, strain);
        if (!cancelled) setState({ key, strain });
      },
      () => {
        if (!cancelled) setState({ key, strain: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, key, maxHr, workout.id, workout.complete]);

  if (cached !== undefined) return cached;
  return state?.key === key ? state.strain : undefined;
}
