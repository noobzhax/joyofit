import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { formatLogLine } from '@/features/log/formatLog';
import { LogRow } from '@/features/log/LogRow';
import { LOG_CAPACITY, useLogBuffer } from '@/state/logStore';
import { radius, space, usePalette } from '@/theme';
import type { LogDirection } from '@/wear';

type Filter = 'all' | LogDirection;

const FILTERS: readonly Filter[] = ['all', 'tx', 'rx', 'info', 'error'];

export default function LogScreen() {
  const palette = usePalette();
  const buffer = useLogBuffer();
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState(false);

  // Newest first.
  const rows = useMemo(
    () => buffer.filter((e) => filter === 'all' || e.event.direction === filter).reverse(),
    [buffer, filter],
  );

  async function copyBuffer() {
    await Clipboard.setStringAsync(buffer.map((e) => formatLogLine(e.event)).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={styles.toolbar}>
        <View style={styles.filters} accessibilityRole="tablist">
          {FILTERS.map((f) => {
            const selected = f === filter;
            return (
              <Pressable
                key={f}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setFilter(f)}
                style={[
                  styles.chip,
                  {
                    borderColor: selected ? palette.accent : palette.border,
                    backgroundColor: selected ? palette.accent : 'transparent',
                  },
                ]}>
                <AppText
                  variant="caption"
                  style={{ color: selected ? palette.onAccent : palette.text, fontWeight: '600' }}>
                  {f}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <Button
          label={copied ? 'Copied' : 'Copy all'}
          disabled={buffer.length === 0}
          onPress={() => void copyBuffer()}
        />
      </View>
      <AppText variant="caption" muted style={styles.count}>
        {rows.length} shown, {buffer.length} of {LOG_CAPACITY} buffered
      </AppText>
      <FlatList
        data={rows}
        keyExtractor={(e) => String(e.id)}
        renderItem={({ item }) => <LogRow event={item.event} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <AppText variant="caption" muted>
            {buffer.length === 0
              ? 'No events yet. Connect a watch on the Device tab and its traffic will appear here.'
              : `No ${filter} events in the buffer.`}
          </AppText>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: { padding: space.lg, paddingBottom: space.sm, gap: space.md },
  filters: { flexDirection: 'row', gap: space.sm },
  chip: {
    minHeight: 36,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
  },
  count: { paddingHorizontal: space.lg },
  list: { padding: space.lg, paddingTop: space.sm },
});
