import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { formatDateTime } from '@/format';
import { useMeals } from '@/state/MealsProvider';

/** The "Meals on watch" card: what JoyoFit last read from JoyoRogo and last pushed to the watch's calorie card. */
export function MealsSection() {
  const meals = useMeals();
  const { diet } = meals;
  useNativeRefresh(meals.reloadStatus);

  const supported = diet.supported;
  const support = supported
    ? [
        supported.config ? 'goals' : null,
        supported.point ? 'meals' : null,
        supported.dictionary ? 'weight' : null,
        supported.event ? 'requests' : null,
        supported.extraMealSlots ? 'extra slots' : null,
      ]
        .filter(Boolean)
        .join(', ')
    : null;

  return (
    <Section title="Meals on watch" icon="restaurant">
      <AppText variant="caption" muted>
        Your JoyoRogo food diary and calorie target feed the calorie card on the watch. JoyoFit reads them when it opens, after each
        sync and when the watch connects, and sends them again when the watch asks or logs a meal itself. While the app is closed the
        background service answers from the last day it stored; it cannot read JoyoRogo then, because the sign-in is kept for the app
        only. Untested on the Fit 4 Pro so far.
      </AppText>
      <AppText variant="caption" muted>
        While signed in, the app also sends your daily Recovery, Strain and Sleep to the JoyoRogo diary so they sit next to your food.
      </AppText>
      <KeyValue icon="person" label="JoyoRogo" value={meals.signedIn ? 'Signed in' : CLOUD_CONFIGURED ? 'Not signed in' : 'Not signed in (cloud off)'} />
      <KeyValue icon="calendar" label="Day on the watch" value={diet.date} />
      <KeyValue
        icon="restaurant"
        label="Meals"
        value={
          diet.mealCount === null
            ? null
            : `${diet.mealCount} meal${diet.mealCount === 1 ? '' : 's'}, ${Math.round(diet.intakeKcal ?? 0)}${diet.goals ? ` of ${diet.goals.dailyKcal}` : ''} kcal`
        }
      />
      <KeyValue icon="download" label="Last read from JoyoRogo" value={meals.lastRefreshAt ? formatDateTime(meals.lastRefreshAt / 1000) : null} />
      <KeyValue icon="send" label="Last push to the watch" value={diet.pushedAt ? formatDateTime(diet.pushedAt / 1000) : null} />
      <KeyValue icon="checkmark-circle" label="Last result" value={diet.lastResult} />
      <KeyValue icon="watch" label="Watch accepts" value={support === null ? 'Not connected' : support || 'nothing'} />
      {diet.unsyncedWatchMeals ? (
        <Notice>
          {diet.unsyncedWatchMeals} meal{diet.unsyncedWatchMeals === 1 ? '' : 's'} logged on the watch will be written to JoyoRogo the
          next time the app reads it.
        </Notice>
      ) : null}
      {meals.lastRefreshNote ? (
        <AppText variant="caption" muted>
          {meals.lastRefreshNote}
        </AppText>
      ) : null}
      {meals.error ? <Notice tone="danger">{meals.error}</Notice> : null}
      <Button label="Push now" variant="primary" icon="send" loading={meals.refreshing} onPress={() => void meals.pushNow()} />
    </Section>
  );
}
