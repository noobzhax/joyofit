import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

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
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Newest first.
  // Newest first. Search matches the formatted line (message, ids and hex), case-insensitive.
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return buffer
      .filter((e) => filter === 'all' || e.event.direction === filter)
      .filter((e) => needle === '' || formatLogLine(e.event).toLowerCase().includes(needle))
      .reverse();
  }, [buffer, filter, query]);

  async function copy(text: string, what: string) {
    await Clipboard.setStringAsync(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  // Copies what is shown, oldest first, so a search for "TruSleep" copies only those lines.
  function copyShown() {
    void copy(rows.slice().reverse().map((e) => formatLogLine(e.event)).join('\n'), 'shown');
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
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search, e.g. TruSleep"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search log"
          style={[styles.search, { color: palette.text, borderColor: palette.border }]}
        />
        <Button
          label={copied === 'shown' ? 'Copied' : `Copy ${rows.length} shown`}
          disabled={rows.length === 0}
          onPress={copyShown}
        />
      </View>
      <AppText variant="caption" muted style={styles.count}>
        {rows.length} shown, {buffer.length} of {LOG_CAPACITY} buffered. Long-press a line to copy it.{copied === 'line' ? ' Line copied.' : ''}
      </AppText>
      <FlatList
        data={rows}
        keyExtractor={(e) => String(e.id)}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => void copy(formatLogLine(item.event), 'line')} accessibilityHint="Long-press to copy this line">
            <LogRow event={item.event} />
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <AppText variant="caption" muted>
            {buffer.length === 0
              ? 'No events yet. Connect a watch on the Device tab and its traffic will appear here.'
              : query.trim() !== ''
                ? `No events match "${query.trim()}".`
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
  search: {
    minHeight: 44,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    fontSize: 15,
  },
  count: { paddingHorizontal: space.lg },
  list: { padding: space.lg, paddingTop: space.sm },
});
