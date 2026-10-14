import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { radius, space, usePalette } from '@/theme';

export function Screen({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

interface SectionProps {
  title: string;
  children: ReactNode;
}

export function Section({ title, children }: SectionProps) {
  const palette = usePalette();
  return (
    <View style={styles.section}>
      <AppText variant="caption" muted style={styles.sectionTitle}>
        {title}
      </AppText>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xl * 2, gap: space.xl },
  section: { gap: space.sm },
  sectionTitle: { fontWeight: '600', marginLeft: space.xs },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.lg, gap: space.md },
});
