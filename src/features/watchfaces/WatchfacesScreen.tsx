import { useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Screen, Section } from '@/components/Screen';
import { useWatchfaces } from '@/features/watchfaces/useWatchfaces';
import { formatDateTime } from '@/format';
import { radius, usePalette } from '@/theme';
import { FIT4_SCREEN, type WatchfaceInfo } from '@/wear';

/** Lists, activates, deletes and installs watch faces on the connected watch. */
export function WatchfacesScreen() {
  const router = useRouter();
  const palette = usePalette();
  const { connected, list, busy, error, notice, progress, refresh, setActive, remove, install } = useWatchfaces();
  const idle = busy === null;
  const installing = busy === 'install';
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.bytes / progress.total) * 100)) : 0;

  const confirmDelete = (face: WatchfaceInfo) =>
    Alert.alert('Delete watch face', `Delete "${face.name}" from the watch?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(face.id) },
    ]);

  return (
    <Screen>
      <Button label="Back" onPress={() => router.back()} />

      <Section title="Install a watch face">
        <AppText variant="caption">
          Create faces with Huawei Theme Studio Pro and export them as a .hwt file. The Watch Fit 4 and
          Fit 4 Pro screen is {FIT4_SCREEN.width} x {FIT4_SCREEN.height} px (Theme Studio Pro calls it 408 x 480).
          A face made for another screen is refused before it is sent.
        </AppText>
        <AppText variant="caption" muted>
          Whether the watch accepts a face that Huawei did not sign is not known. If it refuses, the exact
          status code it returned is shown here and in the Log tab.
        </AppText>
        {!connected ? (
          <AppText variant="caption" muted>
            Connect the watch on the Device tab first.
          </AppText>
        ) : null}
        <Button label="Install from file" variant="primary" disabled={!connected || !idle} loading={installing} onPress={() => void install()} />
        {installing && progress ? (
          <View style={styles.progress}>
            <View style={[styles.track, { backgroundColor: palette.border }]}>
              <View style={[styles.bar, { backgroundColor: palette.accent, width: `${percent}%` }]} />
            </View>
            <AppText variant="caption" muted>
              {progress.total > 0
                ? `${percent}% (${progress.bytes.toLocaleString()} of ${progress.total.toLocaleString()} bytes)`
                : 'Waiting for the watch to accept the file...'}
            </AppText>
          </View>
        ) : null}
        {notice ? (
          <AppText variant="caption" selectable>
            {notice}
          </AppText>
        ) : null}
        {error ? (
          <AppText variant="caption" danger selectable>
            {error}
          </AppText>
        ) : null}
      </Section>

      <Section title="On the watch">
        {list ? (
          <>
            <KeyValue label="Screen reported by the watch" value={list.width && list.height ? `${list.width} x ${list.height} px` : null} />
            <KeyValue label="Newest face format" value={list.maxVersion} />
            <AppText variant="caption" muted>
              Read {formatDateTime(list.updatedAt / 1000)}.
            </AppText>
          </>
        ) : (
          <AppText variant="caption" muted>
            {connected ? 'Reading the watch faces...' : 'Not read yet.'}
          </AppText>
        )}
        {list && list.faces.length === 0 ? (
          <AppText variant="caption" muted>
            The watch lists no watch faces.
          </AppText>
        ) : null}
        {list?.faces.map((face) => {
          const working = typeof busy === 'object' && busy !== null && busy.id === face.id;
          return (
            <View key={face.id} style={[styles.face, { borderColor: palette.border }]}>
              <AppText variant="title">
                {face.name}
                {face.active ? '  (active)' : ''}
              </AppText>
              <AppText variant="caption" muted>
                {face.id} v{face.version}
                {face.factory ? ' · preinstalled' : ''}
                {face.tryout ? ' · trial' : ''}
                {face.video ? ' · video' : ''}
                {face.photo ? ' · photo' : ''}
              </AppText>
              <View style={styles.actions}>
                <Button
                  label="Set active"
                  disabled={!connected || !idle || face.active}
                  loading={working && typeof busy === 'object' && busy?.action === 'activate'}
                  onPress={() => void setActive(face.id)}
                />
                <Button
                  label="Delete"
                  variant="danger"
                  disabled={!connected || !idle || face.factory}
                  loading={working && typeof busy === 'object' && busy?.action === 'delete'}
                  onPress={() => confirmDelete(face)}
                />
              </View>
            </View>
          );
        })}
        <Button label="Read from the watch" disabled={!connected || !idle} loading={busy === 'list'} onPress={() => void refresh()} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  face: { gap: 6, borderTopWidth: 1, paddingTop: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  progress: { gap: 6 },
  track: { height: 8, borderRadius: radius.sm, overflow: 'hidden' },
  bar: { height: 8 },
});
