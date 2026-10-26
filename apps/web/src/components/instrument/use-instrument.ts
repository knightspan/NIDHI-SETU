'use client';

import type { InstrumentDetail } from '@nidhisetu/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage, type ApiOptions } from '@/lib/api-client';

export function useInstrument(id: string) {
  return useQuery({
    queryKey: ['instrument', id],
    queryFn: () => api<InstrumentDetail>(`/api/instruments/${id}`),
  });
}

/** POST/PATCH an action, toast the result and refresh everything that may have changed. */
export function useInstrumentAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, ...opts }: { path: string; success?: string } & ApiOptions) =>
      api<unknown>(path, { method: 'POST', ...opts }),
    onSuccess: async (_d, v) => {
      if (v.success) toast.success(v.success);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['instrument', id] }),
        qc.invalidateQueries({ queryKey: ['instruments'] }),
        qc.invalidateQueries({ queryKey: ['discrepancies'] }),
        qc.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
