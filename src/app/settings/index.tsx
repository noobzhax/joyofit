import { useRouter, type Href } from 'expo-router';
import { SectionList, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { PageHeader, useContentPadding } from '@/components/Screen';
import { spacing, useColors, type Tint } from '@/theme';

interface SettingsRow {
  title: string;
  subtitle?: string;
  icon: IconName;
  tint?: Tint;
  href: Href;
}

interface SettingsGroup {
  title: string;
  data: readonly SettingsRow[];
}

const GROUPS: readonly SettingsGroup[] = [
  {
    title: 'On the watch',
    data: [
      {
        title: 'Background and sync',
        subtitle: 'Stay connected, sync interval',
        icon: 'sync',
        href: '/settings/sync',
      },
      {
        title: 'Notifications and calls',
        subtitle: 'Forwarding, find my phone, call control',
        icon: 'notifications',
        href: '/settings/notifications',
      },
      {
        title: 'Notification apps',
        subtitle: 'Choose which apps notify the watch',
        icon: 'apps',
        href: '/settings/notification-apps',
      },
      {
        title: 'Weather',
        subtitle: 'Location, unit, update interval',
        icon: 'partly-sunny',
        href: '/settings/weather',
      },
      {
        title: 'Safety',
        subtitle: 'Fall detection, SOS texts, sleep report',
        icon: 'shield-checkmark',
        tint: 'heart',
        href: '/settings/safety',
      },
      {
        title: 'Meals on watch',
        subtitle: 'JoyoRogo diary and calorie target on the watch',
        icon: 'restaurant',
        href: '/settings/meals',
      },
      {
        title: 'Goals and reminders',
        subtitle: 'Steps, calories, exercise, stand, ring reminders',
        icon: 'flag',
        href: '/settings/goals',
      },
    ],
  },
  {
    title: 'You and your data',
    data: [
      {
        title: 'Health Connect and cloud',
        subtitle: 'Share data with other apps, back up',
        icon: 'heart',
        tint: 'heart',
        href: '/settings/health',
      },
      {
        title: 'Profile and goal',
        subtitle: 'Height, weight, daily step goal',
        icon: 'person',
        href: '/settings/profile',
      },
      {
        title: 'Cycle',
        subtitle: 'Period log, estimates, calendar on the watch',
        icon: 'calendar',
        tint: 'heart',
        href: '/settings/cycle',
      },
    ],
  },
  {
    title: 'Advanced',
    data: [
      { title: 'Log', subtitle: 'Watch traffic and events', icon: 'terminal', href: '/settings/log' },
      { title: 'About', icon: 'information-circle', href: '/settings/about' },
    ],
  },
];

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const padding = useContentPadding(true);

  return (
    <SectionList
      sections={GROUPS}
      keyExtractor={(row) => row.href as string}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      stickySectionHeadersEnabled
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={<PageHeader title="Settings" />}
      renderSectionHeader={({ section }) => (
        <AppText
          variant="heading"
          accessibilityRole="header"
          style={[styles.groupTitle, { backgroundColor: colors.background }]}>
          {section.title}
        </AppText>
      )}
      renderItem={({ item, index, section }) => (
        <NavRow
          icon={item.icon}
          tint={item.tint}
          title={item.title}
          subtitle={item.subtitle}
          onPress={() => router.push(item.href)}
          style={groupedRowStyle(colors, index, section.data.length)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  groupTitle: { paddingTop: spacing.lg, paddingBottom: spacing.sm },
});
