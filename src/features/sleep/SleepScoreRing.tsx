import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Ring } from '@/components/Ring';
import type { SleepScoreRow } from '@/db/queries';
import { useColors } from '@/theme';

/** The watch's sleep score out of 100 as a ring. The number is the watch's; JoyoFit does not compute one. */
export function SleepScoreRing({ score, size = 76 }: { score: SleepScoreRow; size?: number }) {
  const colors = useColors();
  return (
    <Ring
      size={size}
      stroke={7}
      value={score.score}
      max={100}
      color={colors.sleep}
      track={colors.sleepSoft}
      accessibilityLabel={`Sleep score ${score.score} out of 100, from the watch`}>
      <View style={styles.center}>
        <AppText variant="heading" color={colors.sleepText} style={styles.value}>
          {score.score}
        </AppText>
        <AppText variant="caption" muted style={styles.caption}>
          Score
        </AppText>
      </View>
    </Ring>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  value: { fontVariant: ['tabular-nums'] },
  caption: { fontSize: 11, lineHeight: 14 },
});
