import { useEffect, useState } from 'react';

/** Current time in unix milliseconds, refreshed every `intervalMs`, so relative times ("5 min ago") stay right. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
