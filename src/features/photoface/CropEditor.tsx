import { useEffect, useMemo, useState } from 'react';
import { Image, Modal, PanResponder, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { CropGesture } from '@/features/photoface/CropGesture';
import {
  cropRect,
  frameSize,
  initialView,
  MAX_ZOOM,
  zoomTo,
  type CropRect,
  type CropView,
  type Size,
} from '@/features/photoface/cropMath';
import { radius, spacing, useColors } from '@/theme';

export interface CropSource extends Size {
  uri: string;
}

interface CropEditorProps {
  /** The picture to crop; null keeps the editor closed. */
  source: CropSource | null;
  /** The size the crop ends up at: only its aspect ratio shapes the frame. */
  target: Size;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (rect: CropRect) => void;
}

const ZOOM_STEP = 1.2;

/**
 * Full-screen crop of one picture to the watch's aspect ratio: drag to move, pinch or use the zoom buttons to scale.
 * The frame is the crop; what is inside it is what the watch will show.
 */
export function CropEditor({ source, target, busy, onCancel, onConfirm }: CropEditorProps) {
  return (
    <Modal visible={source !== null} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      {source ? (
        <CropSurface key={source.uri} source={source} target={target} busy={busy} onCancel={onCancel} onConfirm={onConfirm} />
      ) : null}
    </Modal>
  );
}

function CropSurface({ source, target, busy, onCancel, onConfirm }: CropEditorProps & { source: CropSource }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const frame = useMemo(
    () => frameSize(target, window.width - spacing.lg * 2, window.height - insets.top - insets.bottom - 260),
    [target, window.width, window.height, insets.top, insets.bottom],
  );
  const [view, setView] = useState<CropView>(() => initialView(source, frame));
  // The responder is created once; the tracker behind it is told the current view after every render.
  const [tracker] = useState(() => new CropGesture(view, source, frame, setView));
  useEffect(() => {
    tracker.sync(view, source, frame);
  }, [tracker, view, source, frame]);
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => tracker.start(),
      onPanResponderMove: (event, state) => tracker.move(event.nativeEvent.touches, state.dx, state.dy),
    }),
  );

  const zoom = (factor: number) => setView(zoomTo(view, view.scale * factor, source, frame));

  const minScale = initialView(source, frame).scale;
  const drawn = { width: source.width * view.scale, height: source.height * view.scale };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.head}>
        <AppText variant="heading">Crop the photo</AppText>
        <AppText variant="caption" muted>
          Drag to move, pinch to zoom. The frame is what the watch shows, {target.width} x {target.height} px.
        </AppText>
      </View>

      <View style={styles.stage}>
        <View
          {...responder.panHandlers}
          accessible
          accessibilityLabel="Crop frame. Drag to move the photo, use the zoom buttons to scale it."
          style={[styles.frame, { width: frame.width, height: frame.height, backgroundColor: colors.muted }]}>
          <Image
            source={{ uri: source.uri }}
            resizeMode="stretch"
            style={{
              position: 'absolute',
              width: drawn.width,
              height: drawn.height,
              left: frame.width / 2 + view.x - drawn.width / 2,
              top: frame.height / 2 + view.y - drawn.height / 2,
            }}
          />
        </View>
      </View>

      <View style={styles.zoomRow}>
        <Button label="Zoom out" icon="remove" disabled={busy || view.scale <= minScale * 1.001} onPress={() => zoom(1 / ZOOM_STEP)} />
        <Button label="Zoom in" icon="add" disabled={busy || view.scale >= minScale * MAX_ZOOM * 0.999} onPress={() => zoom(ZOOM_STEP)} />
      </View>
      <View style={styles.zoomRow}>
        <Button label="Cancel" variant="ghost" disabled={busy} onPress={onCancel} />
        <Button label="Send to the watch" variant="primary" icon="cloud-upload" loading={busy} onPress={() => onConfirm(cropRect(view, source, frame))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  head: { gap: spacing.xs, paddingTop: spacing.md },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { overflow: 'hidden', borderRadius: radius.tile },
  zoomRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.sm },
});
