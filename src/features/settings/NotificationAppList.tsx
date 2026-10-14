import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { IconChip } from '@/components/IconChip';
import { Field } from '@/components/Input';
import { groupedRowStyle } from '@/components/NavRow';
import { useContentPadding } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { errorMessage } from '@/format';
import { spacing, useColors } from '@/theme';
import { HuaweiWear, type NotificationApp } from '@/wear';

const ROW_HEIGHT = 64;
const SKELETON_ROWS = 8;

/** Per-app forwarding switches: searchable, windowed, with a sticky header. Loads the apps once. */
export function NotificationAppList() {
  const colors = useColors();
  const padding = useContentPadding(false);
  const [apps, setApps] = useState<NotificationApp[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Apps that were on when "Enabled first" was turned on. Frozen so rows do not jump while toggling.
  const [pinned, setPinned] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    let live = true;
    HuaweiWear.getNotificationApps().then(
      (list) => {
        if (live) setApps(list);
      },
      (e) => {
        if (live) setError(errorMessage(e));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const visible = useMemo(() => {
    if (!apps) return [];
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? apps.filter(
          (app) =>
            app.label.toLowerCase().includes(needle) ||
            app.packageName.toLowerCase().includes(needle),
        )
      : apps;
    if (!pinned) return matching;
    return [
      ...matching.filter((app) => pinned.has(app.packageName)),
      ...matching.filter((app) => !pinned.has(app.packageName)),
    ];
  }, [apps, filter, pinned]);

  const enabledCount = useMemo(() => apps?.filter((app) => app.enabled).length ?? 0, [apps]);

  const setEnabled = async (packageName: string, enabled: boolean) => {
    setError(null);
    const update = (value: boolean) =>
      setApps((list) =>
        list ? list.map((a) => (a.packageName === packageName ? { ...a, enabled: value } : a)) : list,
      );
    update(enabled);
    try {
      await HuaweiWear.setNotificationAppEnabled(packageName, enabled);
    } catch (e) {
      update(!enabled);
      setError(errorMessage(e));
    }
  };

  const toggleEnabledFirst = () =>
    setPinned(
      pinned || !apps ? null : new Set(apps.filter((app) => app.enabled).map((app) => app.packageName)),
    );

  const getItemLayout = useCallback(
    (_: ArrayLike<NotificationApp> | null | undefined, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const header = (
    <View style={[styles.header, { backgroundColor: colors.background }]}>
      <Field
        label="Filter apps"
        icon="search"
        value={filter}
        onChangeText={setFilter}
        placeholder="Filter apps"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <View style={styles.headerRow}>
        <Chip label="Enabled first" role="checkbox" selected={pinned !== null} onPress={toggleEnabledFirst} />
        <AppText variant="caption" muted>
          {apps ? `${enabledCount} of ${apps.length} on` : ''}
        </AppText>
      </View>
      <AppText variant="caption" muted>
        Apps you haven&apos;t chosen are on, except system apps.
      </AppText>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </View>
  );

  return (
    <FlatList
      data={visible}
      keyExtractor={(app) => app.packageName}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={[0]}
      ListHeaderComponent={header}
      getItemLayout={getItemLayout}
      initialNumToRender={14}
      maxToRenderPerBatch={14}
      windowSize={9}
      removeClippedSubviews
      renderItem={({ item, index }) => (
        <View style={[styles.row, groupedRowStyle(colors, index, visible.length)]}>
          <IconChip icon="apps" size="md" />
          <View style={styles.text}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {item.label}
            </AppText>
            <AppText variant="caption" muted numberOfLines={1}>
              {item.packageName}
            </AppText>
          </View>
          <Switch
            accessibilityLabel={item.label}
            value={item.enabled}
            onValueChange={(enabled) => setEnabled(item.packageName, enabled)}
            trackColor={{ false: colors.switchOff, true: colors.primary }}
            thumbColor={item.enabled ? colors.primaryForeground : colors.card}
          />
        </View>
      )}
      ListEmptyComponent={
        apps === null && !error ? (
          <View accessibilityLabel="Loading apps">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <View key={i} style={[styles.row, groupedRowStyle(colors, i, SKELETON_ROWS)]}>
                <Skeleton width={40} height={40} radius={20} />
                <View style={styles.text}>
                  <Skeleton width="55%" height={14} />
                  <Skeleton width="80%" height={10} />
                </View>
              </View>
            ))}
          </View>
        ) : apps !== null ? (
          <EmptyState
            icon="search"
            title="No apps match"
            description={filter.trim() ? `Nothing matches "${filter.trim()}".` : 'No apps to show.'}
            action={filter ? { label: 'Clear filter', onPress: () => setFilter('') } : undefined}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  text: { flex: 1, gap: 2 },
});
