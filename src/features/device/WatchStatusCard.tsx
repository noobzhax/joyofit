import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { StatusDot } from '@/components/StatusDot';
import { Notice } from '@/components/States';
import { isLinkLive, isLinkUp, LINK_LABEL } from '@/features/device/linkState';
import { useBackgroundStatus } from '@/features/settings/useBackgroundStatus';
import { formatSyncTime } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { radius, spacing, useColors } from '@/theme';

/** Battery at or under this percent turns the bar to the warning color. */
const LOW_BATTERY = 20;

/**
 * The dark "watch screen" panel at the top of the Watch tab: link state, which watch, battery and
 * last sync. The dot pulses only while the link is up or being set up.
 */
export function WatchStatusCard() {
  const colors = useColors();
  const { linkState, device, battery, lastSync, error } = useWatch();
  const { status: background } = useBackgroundStatus();

  const label = LINK_LABEL[linkState];
  const dotColor = isLinkUp(linkState) ? colors.heroLink : linkState === 'disconnected' ? colors.heroMuted : colors.heroWarn;
  const batteryColor = battery !== null && battery <= LOW_BATTERY ? colors.heroWarn : colors.heroLink;

  return (
    <View style={[styles.card, { backgroundColor: colors.hero }]}>
      <View style={styles.linkRow} accessible accessibilityLabel={`Link state: ${label}`}>
        <StatusDot color={dotColor} live={isLinkLive(linkState)} />
        <AppText variant="heading" color={colors.heroForeground}>
          {label}
        </AppText>
      </View>

      <View style={styles.identity}>
        <AppText variant="title" color={colors.heroForeground} numberOfLines={1}>
          {device?.name ?? 'No watch connected'}
        </AppText>
        <AppText variant="caption" color={colors.heroMuted} numberOfLines={1}>
          {device ? (device.productModel ?? 'Model not reported') : 'Connect a paired watch to see it here.'}
        </AppText>
      </View>

      {battery !== null ? (
        <View style={styles.battery} accessible accessibilityLabel={`Battery ${battery}%`}>
          <AppText variant="label" color={colors.heroMuted}>
            Battery
          </AppText>
          <Metric value={String(battery)} unit="%" size="hero" color={colors.heroForeground} unitColor={colors.heroMuted} />
          <View style={[styles.track, { backgroundColor: colors.heroTrack }]}>
            <View style={[styles.fill, { backgroundColor: batteryColor, width: `${Math.min(100, Math.max(0, battery))}%` }]} />
          </View>
        </View>
      ) : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {lastSync !== null || background.address ? (
        <View style={[styles.footer, { borderTopColor: colors.heroDivider }]}>
          {lastSync !== null ? (
            <AppText variant="caption" color={colors.heroMuted}>
              Last sync {formatSyncTime(lastSync)}
            </AppText>
          ) : null}
          {background.address ? (
            <AppText variant="caption" color={colors.heroMuted}>
              Remembered for background: {background.name ?? background.address}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, padding: spacing.lg, gap: spacing.lg },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  identity: { gap: 2 },
  battery: { gap: spacing.xs },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden', marginTop: spacing.sm },
  fill: { height: 6, borderRadius: radius.pill },
  footer: { gap: spacing.xs, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
