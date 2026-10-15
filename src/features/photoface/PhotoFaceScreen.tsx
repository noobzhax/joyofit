import { useRouter } from 'expo-router';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Card, Section, useContentPadding, useRefreshControl } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { CropEditor } from '@/features/photoface/CropEditor';
import { usePhotoFace } from '@/features/photoface/usePhotoFace';
import { radius, spacing, tintColors, useColors } from '@/theme';
import type { PhotoFacePhoto } from '@/wear';

/** One photo of the face: the local copy when this phone uploaded it, otherwise a labelled stand-in. */
function PhotoTile({
  photo,
  ratio,
  disabled,
  deleting,
  onDelete,
}: {
  photo: PhotoFacePhoto;
  ratio: number;
  disabled: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.tile}>
      <View style={[styles.thumb, { aspectRatio: ratio, backgroundColor: colors.muted }]}>
        {photo.uri ? (
          <Image source={{ uri: photo.uri }} style={styles.fill} resizeMode="cover" accessibilityLabel={`Photo ${photo.index}`} />
        ) : (
          <View style={styles.standIn}>
            <IconChip icon="image" />
            <AppText variant="caption" muted style={styles.centered}>
              Added from another phone, no preview
            </AppText>
          </View>
        )}
      </View>
      <Button
        label={`Delete photo ${photo.index}`}
        icon="trash"
        variant="destructive"
        disabled={disabled}
        loading={deleting}
        onPress={onDelete}
      />
    </View>
  );
}

/** Adds, lists and deletes the photos of the watch's photo face. */
export function PhotoFaceScreen() {
  const router = useRouter();
  const colors = useColors();
  const padding = useContentPadding(false);
  const { connected, face, busy, error, notice, progress, cropSource, cancelCrop, refresh, activate, remove, pick, sendCrop } =
    usePhotoFace();
  const refreshControl = useRefreshControl({ refreshing: busy === 'read', onRefresh: () => void refresh(), enabled: connected });
  const idle = busy === null;
  const full = face !== null && face.maxPhotos > 0 && face.photos.length >= face.maxPhotos;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.bytes / progress.total) * 100)) : 0;
  const link = tintColors(colors, 'link');

  const confirmDelete = (photo: PhotoFacePhoto) =>
    Alert.alert('Delete photo', `Remove photo ${photo.index} from the watch face?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(photo.name) },
    ]);

  return (
    <>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[padding, styles.content]}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}>
        <Section title="Photo watch face" icon="images">
          {!connected ? (
            <Notice icon="bluetooth" action={{ label: 'Open Watch', onPress: () => router.navigate('/watch') }}>
              Connect your watch to manage the photos on its photo face.
            </Notice>
          ) : null}
          {busy === 'read' && face === null ? (
            <View style={styles.skeletons}>
              <Skeleton width="60%" height={18} />
              <Skeleton width="40%" height={13} />
            </View>
          ) : null}
          {face ? (
            <>
              <View style={styles.faceHeader}>
                <View style={styles.faceText}>
                  <AppText variant="bodyStrong" numberOfLines={2}>
                    {face.face.name}
                  </AppText>
                  <AppText variant="caption" muted>
                    {face.photos.length} of {face.maxPhotos} photos · {face.width} x {face.height} px
                  </AppText>
                </View>
                {face.face.active ? (
                  <View style={[styles.pill, { backgroundColor: link.soft }]}>
                    <AppText variant="label" color={link.text}>
                      Active
                    </AppText>
                  </View>
                ) : null}
              </View>
              <View style={styles.actions}>
                <Button
                  label="Add a photo"
                  icon="add-circle"
                  variant="primary"
                  disabled={!connected || !idle || full}
                  loading={busy === 'prepare'}
                  onPress={() => void pick()}
                />
                {!face.face.active ? (
                  <Button
                    label="Show on the watch"
                    icon="checkmark-circle"
                    disabled={!connected || !idle}
                    loading={busy === 'activate'}
                    onPress={() => void activate()}
                  />
                ) : null}
              </View>
              {full ? <AppText variant="caption" muted>The face holds {face.maxPhotos} photos. Delete one to add another.</AppText> : null}
            </>
          ) : null}
          {busy === 'send' && progress ? (
            <View style={styles.progress}>
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                style={[styles.track, { backgroundColor: colors.muted }]}>
                <View style={[styles.bar, { backgroundColor: colors.primary, width: `${percent}%` }]} />
              </View>
              <AppText variant="caption" muted>
                {progress.total > 0
                  ? `${percent}% (${progress.bytes.toLocaleString()} of ${progress.total.toLocaleString()} bytes)`
                  : 'Waiting for the watch to ask for the photo...'}
              </AppText>
            </View>
          ) : null}
          {notice ? <Notice icon="checkmark-circle">{notice}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </Section>

        {face ? (
          <Section title="Photos on the face" icon="image">
            {face.photos.length === 0 ? (
              <EmptyState
                icon="image"
                title="No photos yet"
                description="The face has no photo to show. Add one from your gallery and crop it to the watch screen."
              />
            ) : (
              <View style={styles.grid}>
                {face.photos.map((photo) => (
                  <PhotoTile
                    key={photo.name}
                    photo={photo}
                    ratio={face.width / face.height}
                    disabled={!connected || !idle}
                    deleting={typeof busy === 'object' && busy !== null && busy.name === photo.name}
                    onDelete={() => confirmDelete(photo)}
                  />
                ))}
              </View>
            )}
          </Section>
        ) : (
          <Card>
            <EmptyState
              icon="images"
              title={connected ? 'Photo face not read' : 'Watch not connected'}
              description={
                connected
                  ? 'Read the face from your watch to see its photos.'
                  : 'The photo face of your watch appears here once it is connected.'
              }
              action={connected ? { label: 'Read from the watch', icon: 'refresh', onPress: () => void refresh() } : undefined}
            />
          </Card>
        )}
      </ScrollView>

      <CropEditor
        source={cropSource}
        target={{ width: face?.width ?? 408, height: face?.height ?? 480 }}
        busy={busy === 'send'}
        onCancel={cancelCrop}
        onConfirm={(rect) => void sendCrop(rect)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl },
  skeletons: { gap: spacing.sm },
  faceHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  faceText: { flex: 1, gap: 2 },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  progress: { gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '47%', flexGrow: 1, gap: spacing.sm },
  thumb: { width: '100%', borderRadius: radius.tile, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  standIn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  centered: { textAlign: 'center' },
});
