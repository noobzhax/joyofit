import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { PageHeader, useContentPadding, useRefreshControl } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { listWorkouts, type WorkoutRow } from '@/db/queries';
import { sportIcon } from '@/features/workouts/sportIcon';
import { formatElapsed, formatWorkoutDistance } from '@/features/workouts/summary';
import { useWorkoutStrain } from '@/features/workouts/useWorkoutStrain';
import { errorMessage, formatCount, formatDateTime } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { radius, spacing, tintColors, useColors } from '@/theme';

interface MonthGroup {
  title: string;
  data: WorkoutRow[];
}

/** Consecutive workouts of the same month under one heading; relies on the query's newest-first order. */
function groupByMonth(workouts: readonly WorkoutRow[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const workout of workouts) {
    const title = new Date(workout.start * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.data.push(workout);
    else groups.push({ title, data: [workout] });
  }
  return groups;
}

function WorkoutCard({ workout }: { workout: WorkoutRow }) {
  const router = useRouter();
  const colors = useColors();
  const heart = tintColors(colors, 'heart');
  // `formatWorkoutDistance` returns "2.34 km"; the card shows the number big and the unit small.
  const [distance, distanceUnit] = formatWorkoutDistance(workout.distance).split(' ');
  const strain = useWorkoutStrain(workout);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${workout.sportName}, ${formatDateTime(workout.start)}`}
      onPress={() => router.push({ pathname: '/workouts/[id]', params: { id: String(workout.id) } })}
      style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.cardHead}>
        <IconChip icon={sportIcon(workout.sportName)} tint="workouts" />
        <View style={styles.cardTitle}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {workout.sportName}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {formatDateTime(workout.start)}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </View>
      <View style={styles.metrics}>
        <Metric value={formatElapsed(workout.duration)} size="sm" />
        {workout.distance > 0 ? <Metric value={distance} unit={distanceUnit} size="sm" /> : null}
        {workout.calories > 0 ? <Metric value={formatCount(workout.calories)} unit="kcal" size="sm" /> : null}
        {workout.avgHr !== null ? (
          <Metric value={String(workout.avgHr)} unit="bpm avg" size="sm" color={heart.text} unitColor={heart.text} />
        ) : null}
        {strain !== null && strain !== undefined ? (
          <Metric value={strain.toFixed(1)} unit="strain" size="sm" color={colors.workoutsText} unitColor={colors.workoutsText} />
        ) : null}
      </View>
      {!workout.complete ? (
        <View style={styles.partial}>
          <Ionicons name="cloud-download-outline" size={16} color={colors.mutedForeground} />
          <AppText variant="caption" muted style={styles.partialText}>
            Partly downloaded; the next sync fetches the rest.
          </AppText>
        </View>
      ) : null}
    </PressableScale>
  );
}

function WorkoutSkeletons() {
  return (
    <View style={styles.skeletons}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} width="100%" height={116} radius={radius.card} />
      ))}
    </View>
  );
}

export default function WorkoutsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // The status-bar inset is applied outside the list so sticky month headers stop below it.
  const padding = useContentPadding(false);
  const { linkState, device, dataVersion, sync } = useWatch();
  const [workouts, setWorkouts] = useState<WorkoutRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

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
  const syncing = linkState === 'syncing';
  const sections = useMemo(() => groupByMonth(workouts ?? []), [workouts]);
  const refreshControl = useRefreshControl({
    refreshing: pulling,
    enabled: canSync,
    onRefresh: () => {
      setPulling(true);
      void sync().finally(() => setPulling(false));
    },
  });

  const connectAction = { label: 'Connect your watch', onPress: () => router.push('/watch') };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <SectionList
        sections={sections}
        keyExtractor={(w) => String(w.id)}
        contentContainerStyle={padding}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageHeader
              title="Workouts"
              right={
                <Button
                  label={syncing ? 'Syncing' : 'Sync now'}
                  variant="primary"
                  icon="sync"
                  disabled={!canSync}
                  loading={syncing}
                  onPress={() => void sync()}
                />
              }
            />
            {error ? <Notice tone="danger">Could not read stored workouts: {error}</Notice> : null}
            {!canSync && !syncing && workouts && workouts.length > 0 ? (
              <Notice icon="watch-outline" action={connectAction}>
                Connect your watch to sync.
              </Notice>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          workouts ? (
            <EmptyState
              icon="fitness"
              title="No workouts yet"
              description="Sessions you record on the watch appear here after a sync."
              action={
                canSync
                  ? { label: 'Sync now', icon: 'sync', onPress: () => void sync() }
                  : syncing
                    ? undefined
                    : connectAction
              }
            />
          ) : error ? null : (
            <WorkoutSkeletons />
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
            <AppText variant="label" muted accessibilityRole="header">
              {section.title}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => <WorkoutCard workout={item} />}
      />
    </View>
  );
}

function ItemGap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  sectionHeader: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  gap: { height: spacing.md },
  card: { borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { flex: 1, gap: 2 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs },
  partial: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  partialText: { flex: 1 },
  skeletons: { gap: spacing.md },
});
