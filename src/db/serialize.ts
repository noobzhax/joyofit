import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * expo-sqlite on Android releases a statement's native object while another query on the same handle is still in
 * flight when several run at once (expo/expo#48995): "NativeDatabase.prepareAsync has been rejected ... Cannot use
 * shared object that was already released", an NPE, or a native crash. Large result sets make it likely, because the
 * garbage they leave makes Hermes collect statement wrappers sooner.
 *
 * Every query helper on the app's one handle is routed through a single promise chain, so only one statement is open
 * at a time. `withTransactionAsync` is not gated itself: it runs BEGIN, the task's own (gated) queries and COMMIT
 * through the gated methods, so gating it as a whole would deadlock its own queries. Remove this once expo-sqlite
 * serializes per handle.
 */
const GATED = ['execAsync', 'runAsync', 'getFirstAsync', 'getAllAsync'] as const;

export function serializeQueries(db: SQLiteDatabase): void {
  let tail: Promise<unknown> = Promise.resolve();
  for (const name of GATED) {
    const original = db[name].bind(db) as (...args: unknown[]) => Promise<unknown>;
    const gated = (...args: unknown[]) => {
      const run = tail.then(
        () => original(...args),
        () => original(...args),
      );
      tail = run.catch(() => undefined);
      return run;
    };
    Object.defineProperty(db, name, { value: gated, configurable: true, writable: true });
  }
}
