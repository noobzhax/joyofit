import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { radius, spacing, useColors, type Tint } from '@/theme';

export interface RefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  /** False greys the gesture out, e.g. while there is no watch to read from. */
  enabled?: boolean;
}

/**
 * Padding for a screen's scrolling content. Tab-root screens draw their own title and sit under the
 * status bar (`withTitle`); stack screens have a native header that already clears it.
 */
export function useContentPadding(withTitle: boolean): ViewStyle {
  const insets = useSafeAreaInsets();
  return {
    paddingTop: (withTitle ? insets.top : 0) + spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  };
}

/** Pull-to-refresh control in the app colors. */
export function useRefreshControl(refresh: RefreshProps | undefined) {
  const colors = useColors();
  if (!refresh) return undefined;
  return (
    <RefreshControl
      refreshing={refresh.refreshing}
      onRefresh={refresh.onRefresh}
      enabled={refresh.enabled ?? true}
      colors={[colors.primary]}
      tintColor={colors.primary}
      progressBackgroundColor={colors.card}
    />
  );
}

interface PageHeaderProps {
  title: string;
  caption?: string;
  right?: ReactNode;
}

/** 28 px page title for tab-root screens, with an optional caption and one right-hand action. */
export function PageHeader({ title, caption, right }: PageHeaderProps) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {caption ? (
          <AppText variant="caption" muted>
            {caption}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

interface ScreenProps {
  /** Draws the big page title; leave out on stack screens that have a native header. */
  title?: string;
  caption?: string;
  right?: ReactNode;
  refresh?: RefreshProps;
  children: ReactNode;
}

export function Screen({ title, caption, right, refresh, children }: ScreenProps) {
  const colors = useColors();
  const padding = useContentPadding(title !== undefined);
  const refreshControl = useRefreshControl(refresh);
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, padding]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}>
      {title ? <PageHeader title={title} caption={caption} right={right} /> : null}
      {children}
    </ScrollView>
  );
}

/** Borderless white card, radius 24, padding 20. Sits flat: no border, no shadow. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card }, style]}>{children}</View>;
}

interface SectionProps {
  title: string;
  icon?: IconName;
  tint?: Tint | 'neutral';
  /** Right of the title, e.g. a count. */
  trailing?: ReactNode;
  /** Makes the whole card a button that opens more detail; the header gets a chevron. */
  onPress?: () => void;
  children: ReactNode;
}

/** A titled card. The title row carries an icon chip so every section is findable at a glance. */
export function Section({ title, icon, tint = 'neutral', trailing, onPress, children }: SectionProps) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader} accessibilityRole="header">
        {icon ? <IconChip icon={icon} tint={tint} size="sm" /> : null}
        <AppText variant="heading" style={styles.sectionTitle}>
          {title}
        </AppText>
        {trailing}
        {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} /> : null}
      </View>
      {onPress ? (
        <PressableScale accessibilityRole="button" accessibilityLabel={title} onPress={onPress} scaleTo={0.985}>
          <Card>{children}</Card>
        </PressableScale>
      ) : (
        <Card>{children}</Card>
      )}
    </View>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={[styles.divider, { backgroundColor: colors.hairline }]} />;
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  pageHeaderText: { flex: 1, gap: 2 },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  sectionTitle: { flex: 1 },
  card: { borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});
