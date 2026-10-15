import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Section } from '@/components/Screen';
import type { Readiness, SignalTone } from '@/features/today/readiness';
import { spacing, useColors } from '@/theme';

const HEADLINE_HINT: Record<NonNullable<Readiness['headline']>, string> = {
  Primed: 'Everything points up. A good day to push.',
  Balanced: 'Nothing stands out. Train as planned.',
  Strained: 'One signal is off. Keep it easy or shorter.',
  'Run down': 'Several signals are off. Rest or move gently.',
};

/** Readiness headline with each signal behind it; signals without enough history say what they still need. */
export function ReadinessSection({ readiness }: { readiness: Readiness }) {
  const colors = useColors();
  const toneColor = (tone: SignalTone) =>
    tone === 'good' ? colors.linkText : tone === 'bad' ? colors.heartText : colors.mutedForeground;

  return (
    <Section title="Readiness" icon="speedometer" tint="link">
      {readiness.headline ? (
        <View style={styles.head}>
          <AppText variant="heading">
            {readiness.headline}
            {readiness.recovery ? `, recovery ${readiness.recovery.percent}%` : ''}
          </AppText>
          <AppText variant="caption" muted>
            {HEADLINE_HINT[readiness.headline]}
          </AppText>
        </View>
      ) : (
        <AppText variant="caption" muted>
          Not enough data yet. Wear the watch day and night and sync daily.
        </AppText>
      )}
      {readiness.signals.map((signal) => (
        <View key={signal.key} style={styles.signal}>
          <View style={styles.signalText}>
            <AppText variant="bodyStrong">{signal.title}</AppText>
            <AppText variant="caption" muted>
              {signal.detail}
            </AppText>
          </View>
          <AppText variant="bodyStrong" color={toneColor(signal.tone)}>
            {signal.value}
          </AppText>
        </View>
      ))}
      {readiness.missing.map((line) => (
        <AppText key={line} variant="caption" muted>
          {line}
        </AppText>
      ))}
      <AppText variant="caption" muted>
        {readiness.recovery
          ? 'Recovery: your usual HRV is 50 %, one standard deviation above it 75 %. '
          : ''}
        Estimates from your own history, not medical advice.
      </AppText>
    </Section>
  );
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  signal: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  signalText: { flex: 1, gap: 2 },
});
