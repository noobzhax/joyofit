import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EMPTY_DRAFT, reviveDraft, type CourseDraft } from '@/features/courses/courseModel';
import { errorMessage } from '@/format';

const KEY = 'joyofit.courseDraft.v1';
const SAVE_DELAY_MS = 400;

/**
 * The course being edited, kept in expo-sqlite's key/value store so leaving the screen (or the app) keeps it. It loads
 * once; edits are saved after a short pause and flushed when the screen closes.
 */
export function useCourseDraft() {
  const [draft, setDraftState] = useState<CourseDraft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef(draft);
  const dirty = useRef(false);

  const write = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await Storage.setItemAsync(KEY, JSON.stringify(latest.current));
      setSaveError(null);
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let live = true;
    Storage.getItemAsync(KEY).then(
      (stored) => {
        if (!live) return;
        if (stored) {
          try {
            const revived = reviveDraft(JSON.parse(stored));
            if (revived) {
              latest.current = revived;
              setDraftState(revived);
            }
          } catch {
            // A damaged draft is dropped; the editor starts empty.
          }
        }
        setLoaded(true);
      },
      (e) => {
        if (!live) return;
        setSaveError(errorMessage(e));
        setLoaded(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // Save a moment after the last edit.
  useEffect(() => {
    const timer = setTimeout(() => void write(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, write]);

  // Flush what is still waiting when the screen closes.
  useEffect(() => () => void write(), [write]);

  const setDraft = useCallback((update: (previous: CourseDraft) => CourseDraft) => {
    const next = update(latest.current);
    latest.current = next;
    dirty.current = true;
    setDraftState(next);
  }, []);

  return { draft, setDraft, loaded, saveError };
}
