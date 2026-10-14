import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { formatPacketId } from '@/features/log/formatLog';
import { formatClockMs } from '@/format';
import { fonts, useColors, type Colors } from '@/theme';
import type { LogEvent } from '@/wear';

function directionColor(direction: LogEvent['direction'], colors: Colors): string {
  switch (direction) {
    case 'tx':
      return colors.primary;
    case 'error':
      return colors.destructive;
    case 'rx':
      return colors.foreground;
    case 'info':
      return colors.mutedForeground;
  }
}

export const LogRow = memo(function LogRow({ event }: { event: LogEvent }) {
  const colors = useColors();
  const id = formatPacketId(event);
  return (
    <View style={[styles.row, { borderBottomColor: colors.hairline }]}>
      <View style={styles.head}>
        <AppText variant="mono" muted>
          {formatClockMs(event.ts)}
        </AppText>
        <AppText variant="mono" style={{ color: directionColor(event.direction, colors), fontFamily: fonts.bold }}>
          {event.direction.toUpperCase()}
        </AppText>
        {id ? (
          <AppText variant="mono" muted>
            {id}
          </AppText>
        ) : null}
      </View>
      {event.message ? <AppText variant="caption">{event.message}</AppText> : null}
      {event.hex ? (
        <AppText variant="mono" selectable>
          {event.hex}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingVertical: 8, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
});
