import type { IconName } from '@/components/IconChip';

/** First match wins. Keys are matched against the watch's English sport name. */
const RULES: readonly [RegExp, IconName][] = [
  [/swim|diving|apnea|scuba/i, 'water'],
  [/walk|hik/i, 'walk'],
  [/run|trail/i, 'speedometer'],
  [/cycl|spinning|bik/i, 'bicycle'],
  [/rop|jump/i, 'pulse'],
  [/soccer|football/i, 'football'],
  [/basketball|volleyball/i, 'basketball'],
  [/tennis|badminton|ping/i, 'tennisball'],
  [/yoga|pilates|tai chi|stretch/i, 'body'],
  [/row/i, 'boat'],
  [/box|karate|taekwondo|sparring|martial|kendo|combat|fencing/i, 'flash'],
  [/dance|ballet/i, 'musical-notes'],
  [/strength|crossfit|core|bar|training|hiit|interval|aerobic|elliptical|stepper|stairs/i, 'barbell'],
];

/** Ionicons glyph for a workout, by sport name; falls back to the generic fitness glyph. */
export function sportIcon(sportName: string): IconName {
  return RULES.find(([pattern]) => pattern.test(sportName))?.[1] ?? 'fitness';
}
