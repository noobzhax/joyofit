import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { SwitchRow } from '@/components/SwitchRow';
import { errorMessage } from '@/format';
import { radius, usePalette } from '@/theme';
import { HuaweiWear, type NotificationApp } from '@/wear';

/** Filterable per-app forwarding switches. Mount it only when expanded; it loads the apps once. */
export function NotificationAppList() {
  const palette = usePalette();
  const [apps, setApps] = useState<NotificationApp[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    const needle = filter.trim().toLowerCase();
    if (!apps) return [];
    if (!needle) return apps;
    return apps.filter(
      (app) =>
        app.label.toLowerCase().includes(needle) || app.packageName.toLowerCase().includes(needle),
    );
  }, [apps, filter]);

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

  return (
    <View style={styles.container}>
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder="Filter apps"
        placeholderTextColor={palette.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { borderColor: palette.border, color: palette.text }]}
      />
      <AppText variant="caption" muted>
        Apps you haven&apos;t chosen are on, except system apps.
      </AppText>
      {error ? (
        <AppText variant="caption" danger selectable>
          {error}
        </AppText>
      ) : null}
      {apps === null && !error ? (
        <AppText variant="caption" muted>
          Loading apps
        </AppText>
      ) : null}
      {apps !== null && visible.length === 0 ? (
        <AppText variant="caption" muted>
          No apps match.
        </AppText>
      ) : null}
      {visible.map((app) => (
        <SwitchRow
          key={app.packageName}
          label={app.label}
          value={app.enabled}
          onValueChange={(enabled) => setEnabled(app.packageName, enabled)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: radius.md,
    fontSize: 15,
  },
});
