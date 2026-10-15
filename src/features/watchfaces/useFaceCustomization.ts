import { useEventListener } from 'expo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { sameConfig } from '@/features/watchfaces/faceCustomModel';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type FaceCustomization } from '@/wear';

export type FaceCustomBusy = 'load' | 'apply' | 'revert' | null;

/** `original`: what the watch held when the editor opened (Revert goes back to it). `current`: what the watch holds as far as this screen knows. `draft`: what the user picked. */
interface Configs {
  original: FaceCustomization | null;
  current: FaceCustomization | null;
  draft: FaceCustomization | null;
}

const EMPTY: Configs = { original: null, current: null, draft: null };

/**
 * One face's options. The watch also pushes its own report when the face is edited on the watch; that replaces `current` and,
 * when nothing was picked yet, `draft`.
 */
export function useFaceCustomization(faceId: string) {
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const [configs, setConfigs] = useState<Configs>(EMPTY);
  const [busy, setBusy] = useState<FaceCustomBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { original, current, draft } = configs;

  const run = useCallback(async (kind: Exclude<FaceCustomBusy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const load = useCallback(
    () =>
      run('load', async () => {
        const config = await HuaweiWear.getFaceCustomization(faceId);
        setConfigs((previous) => ({ original: previous.original ?? config, current: config, draft: config }));
      }),
    [faceId, run],
  );

  useFocusEffect(
    useCallback(() => {
      if (connected) void load();
    }, [connected, load]),
  );

  useEventListener(HuaweiWear, 'onFaceCustomization', (event) => {
    if (event.marketId !== faceId) return;
    setConfigs((previous) => {
      const untouched = previous.current === null || previous.draft === null || sameConfig(previous.current, previous.draft);
      return { original: previous.original ?? event, current: event, draft: untouched ? event : previous.draft };
    });
    setNotice('The watch reported new options for this face.');
  });

  const setDraft = useCallback((draftConfig: FaceCustomization) => setConfigs((previous) => ({ ...previous, draft: draftConfig })), []);

  /** Sends `config` and keeps what the watch reads back. */
  const send = useCallback(
    async (config: FaceCustomization, done: string) => {
      const result = await HuaweiWear.applyFaceCustomization(faceId, config);
      if (result.config) {
        const readBack = result.config;
        setConfigs((previous) => ({ ...previous, current: readBack, draft: readBack }));
      }
      if (result.ok) setNotice(done);
      else setError(result.message);
    },
    [faceId],
  );

  const apply = useCallback(
    () => (draft ? run('apply', () => send(draft, 'Applied. The watch reports the new options.')) : Promise.resolve()),
    [draft, run, send],
  );

  /** Back to what the watch held when the editor opened: applied when the watch differs, otherwise just the draft is reset. */
  const revert = useCallback(
    () =>
      original
        ? run('revert', async () => {
            if (current && !sameConfig(current, original)) {
              await send(original, 'Reverted to the options from when you opened this screen.');
            } else {
              setConfigs((previous) => ({ ...previous, draft: original }));
              setNotice('Changes discarded.');
            }
          })
        : Promise.resolve(),
    [current, original, run, send],
  );

  const dirty = draft !== null && current !== null && !sameConfig(draft, current);
  const revertable = original !== null && ((current !== null && !sameConfig(current, original)) || dirty);

  return { connected, draft, setDraft, busy, error, notice, dirty, revertable, load, apply, revert };
}
