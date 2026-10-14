import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { Ring } from '@/components/Ring';
import { StatusDot } from '@/components/StatusDot';
import { isLinkLive, isLinkUp, LINK_LABEL } from '@/features/device/linkState';
import type { HeartReading } from '@/features/today/stats';
import { formatAgo, formatCount, formatSyncTime } from '@/format';
import { radius, spacing, useColors } from '@/theme';
import type { LinkState } from '@/wear';

const LOW_BATTERY = 20;

interface WatchHeroProps {
  linkState: LinkState;
  /** Watch model or name; null while nothing is connected. */
  deviceName: string | null;
  steps: number;
  goal: number;
  /** Live reading, else the newest stored one; null shows `--` and the hint to turn continuous heart rate on. */
  heart: HeartReading | null;
  /** Current unix seconds, ticking, for the "5 min ago" caption. */
  nowSec: number;
  /** Opens the setting that makes the watch record heart rate. */
  onEnableHeartRate: () => void;
  battery: number | null;
  lastSync: number | null;
  /** The one action: sync when the watch is connected, otherwise go and connect it. */
  action: ReactNode;
}

function batteryIcon(level: number) {
  if (level <= LOW_BATTERY) return 'battery-dead';
  return level <= 60 ? 'battery-half' : 'battery-full';
}

/**
 * The watch "screen": today's steps as a ring against the goal, latest heart rate and battery, and
 * the live link state. Dark in both themes on purpose, so the live numbers read like a watch face.
 */
export function WatchHero({ linkState, deviceName, steps, goal, heart, nowSec, battery, lastSync, onEnableHeartRate, action }: WatchHeroProps) {
  const colors = useColors();
  const up = isLinkUp(linkState);
  const dot = up ? colors.heroLink : linkState === 'disconnected' ? colors.heroMuted : colors.heroWarn;
  const lowBattery = battery !== null && battery <= LOW_BATTERY;
  const batteryColor = lowBattery ? colors.heroWarn : colors.heroLink;

  return (
    <View style={[styles.hero, { backgroundColor: colors.hero }]}>
      <View
        style={styles.top}
        accessible
        accessibilityLabel={`Link state: ${LINK_LABEL[linkState]}`}>
        <StatusDot color={dot} live={isLinkLive(linkState)} />
        <AppText variant="bodyStrong" color={colors.heroForeground} style={styles.link}>
          {LINK_LABEL[linkState]}
        </AppText>
        {deviceName ? (
          <AppText variant="caption" color={colors.heroMuted} numberOfLines={1} style={styles.device}>
            {deviceName}
          </AppText>
        ) : null}
      </View>

      <View style={styles.body}>
        <Ring
          size={156}
          stroke={14}
          value={steps}
          max={goal}
          color={colors.heroSteps}
          track={colors.heroTrack}
          accessibilityLabel={`Steps today: ${formatCount(steps)} of ${formatCount(goal)}`}>
          <Ionicons name="footsteps" size={18} color={colors.heroSteps} />
          <Metric value={formatCount(steps)} size="lg" color={colors.heroForeground} />
          <AppText variant="caption" color={colors.heroMuted}>
            of {formatCount(goal)}
          </AppText>
        </Ring>

        <View style={styles.stats}>
          <View
            style={styles.stat}
            accessible={heart !== null}
            accessibilityLabel={
              heart ? `Heart rate ${heart.bpm} bpm, ${heart.live ? 'live' : formatAgo(heart.timestamp, nowSec)}` : undefined
            }>
            <View style={styles.statLabel}>
              <Ionicons name="heart" size={15} color={colors.heroHeart} />
              <AppText variant="label" color={colors.heroMuted}>
                Heart rate
              </AppText>
            </View>
            <Metric value={heart ? String(heart.bpm) : '--'} unit="bpm" size="md" color={colors.heroForeground} unitColor={colors.heroMuted} />
            {heart ? (
              <AppText variant="caption" color={heart.live ? colors.heroLink : colors.heroMuted}>
                {heart.live ? 'Live' : formatAgo(heart.timestamp, nowSec)}
              </AppText>
            ) : (
              <PressableScale
                accessibilityRole="link"
                accessibilityLabel="Turn on continuous heart rate"
                hitSlop={8}
                onPress={onEnableHeartRate}>
                <AppText variant="caption" color={colors.heroLink}>
                  Turn on continuous heart rate
                </AppText>
              </PressableScale>
            )}
          </View>
          <View
            style={styles.stat}
            accessible
            accessibilityLabel={battery === null ? 'Battery: unknown' : `Battery ${battery} percent`}>
            <View style={styles.statLabel}>
              <Ionicons name={battery === null ? 'battery-half' : batteryIcon(battery)} size={15} color={batteryColor} />
              <AppText variant="label" color={colors.heroMuted}>
                Battery
              </AppText>
            </View>
            <Metric value={battery === null ? '--' : String(battery)} unit="%" size="md" color={colors.heroForeground} unitColor={colors.heroMuted} />
          </View>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: colors.heroDivider }]}>
        <View style={styles.sync}>
          <AppText variant="label" color={colors.heroMuted}>
            Last sync
          </AppText>
          <AppText variant="bodyStrong" color={colors.heroForeground}>
            {lastSync !== null ? formatSyncTime(lastSync) : 'Not synced yet'}
          </AppText>
        </View>
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.card, padding: spacing.lg, gap: spacing.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginLeft: -8, minHeight: 28 },
  link: { flexShrink: 0 },
  device: { flex: 1, textAlign: 'right' },
  body: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  stats: { flex: 1, gap: spacing.lg },
  stat: { gap: 2 },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
  },
  sync: { flex: 1 },
});
