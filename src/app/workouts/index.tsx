import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { listWorkouts, type WorkoutRow } from '@/db/queries';
import { formatElapsed, formatWorkoutDistance } from '@/features/workouts/summary';
import { errorMessage, formatCount, formatDateTime } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { radius, space, usePalette } from '@/theme';

export default function WorkoutsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const palette = usePalette();
  const { linkState, device, dataVersion, sync } = useWatch();
  const [workouts, setWorkouts] = useState<WorkoutRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listWorkouts(db).then(
        (rows) => {
          if (!cancelled) {
            setWorkouts(rows);
            setError(null);
          }
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  const canSync = linkState === 'connected' && device !== null;

  return (
    <FlatList
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      data={workouts ?? []}
      keyExtractor={(w) => String(w.id)}
      ListHeaderComponent={
        <View style={styles.header}>
          <Button
            label={linkState === 'syncing' ? 'Syncing' : 'Sync now'}
            variant="primary"
            disabled={!canSync}
            loading={linkState === 'syncing'}
            onPress={() => void sync()}
          />
          {error ? (
            <AppText variant="caption" danger>
              Could not read stored workouts: {error}
            </AppText>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        workouts ? (
          <AppText variant="caption" muted>
            No workouts stored yet. Connect the watch and sync; sessions recorded on the watch appear here.
          </AppText>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.sportName}, ${formatDateTime(item.start)}`}
          onPress={() => router.push({ pathname: '/workouts/[id]', params: { id: String(item.id) } })}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              opacity: pressed ? 0.75 : 1,
            },
          ]}>
          <View style={styles.rowHead}>
            <AppText variant="title">{item.sportName}</AppText>
            <AppText variant="caption" muted>
              {formatDateTime(item.start)}
            </AppText>
          </View>
          <View style={styles.stats}>
            <AppText variant="caption">{formatElapsed(item.duration)}</AppText>
            {item.distance > 0 ? <AppText variant="caption">{formatWorkoutDistance(item.distance)}</AppText> : null}
            {item.calories > 0 ? <AppText variant="caption">{formatCount(item.calories)} kcal</AppText> : null}
            {item.avgHr !== null ? <AppText variant="caption">{item.avgHr} bpm avg</AppText> : null}
          </View>
          {!item.complete ? (
            <AppText variant="caption" muted>
              Partly downloaded; the next sync fetches the rest.
            </AppText>
          ) : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xl * 2, gap: space.md },
  header: { gap: space.sm, marginBottom: space.sm },
  row: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  rowHead: { gap: 2 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: 2 },
});
