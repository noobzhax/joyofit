import { useEventListener } from 'expo';
import { useState } from 'react';

import { HuaweiWear, type HrvProgressEvent } from '@/wear';

/** The countdown of a running HRV measurement or stress calibration; null before the first tick. Call `reset` when starting one. */
export function useHrvProgress(): { progress: HrvProgressEvent | null; reset: () => void } {
  const [progress, setProgress] = useState<HrvProgressEvent | null>(null);
  useEventListener(HuaweiWear, 'onHrvProgress', setProgress);
  return { progress, reset: () => setProgress(null) };
}

/** `ERR_HRV_CANCELLED` is the user's own cancel, not a failure. */
export function isCancelled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'ERR_HRV_CANCELLED';
}
