'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/** Filter state kept in the URL, so views are shareable and survive reloads. */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const state = useMemo(() => {
    const s = {} as Record<K, string | undefined>;
    for (const k of keys) s[k] = params.get(k) ?? undefined;
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys is a constant list
  }, [params]);

  const set = useCallback(
    (patch: Partial<Record<K, string | undefined>>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
        if (v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      if (resetPage && !('page' in patch)) next.delete('page');
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, router, pathname],
  );

  return [state, set] as const;
}
