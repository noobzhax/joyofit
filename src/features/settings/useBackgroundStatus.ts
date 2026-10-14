import { useCallback, useMemo, useState } from 'react';

import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';

/** Background mode status, re-read on focus, on app resume, after `refresh()` and whenever the link state changes. */
export function useBackgroundStatus() {
  const { linkState } = useWatch();
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useNativeRefresh(refresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const status = useMemo(() => HuaweiWear.getBackgroundStatus(), [linkState, version]);

  return { status, refresh };
}
