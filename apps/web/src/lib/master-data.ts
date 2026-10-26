'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api-client';

export interface Bank {
  id: string;
  code: string;
  name: string;
  apiEnabled: boolean;
}

export interface Region {
  id: string;
  code: string;
  name: string;
}

export function useBanks() {
  const q = useQuery({
    queryKey: ['master', 'banks'],
    queryFn: () => api<Bank[]>('/api/master/banks'),
    staleTime: 300_000,
  });
  const byCode = new Map((q.data ?? []).map((b) => [b.code, b]));
  return { ...q, banks: q.data ?? [], bankName: (code: string) => byCode.get(code)?.name };
}

export function useRegions() {
  const q = useQuery({
    queryKey: ['master', 'regions'],
    queryFn: () => api<Region[]>('/api/master/regions'),
    staleTime: 300_000,
  });
  return { ...q, regions: q.data ?? [] };
}
