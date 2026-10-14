import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { HuaweiWear } from '@/wear';

/** Goal shown before a profile has been saved; the same default the profile form starts from. */
export const DEFAULT_STEP_GOAL = 8000;

/** The daily step goal from the saved profile, re-read whenever the screen gains focus. */
export function useStepGoal(): number {
  const [goal, setGoal] = useState(() => HuaweiWear.getUserProfile()?.dailyStepGoal ?? DEFAULT_STEP_GOAL);
  useFocusEffect(
    useCallback(() => {
      setGoal(HuaweiWear.getUserProfile()?.dailyStepGoal ?? DEFAULT_STEP_GOAL);
    }, []),
  );
  return goal;
}
