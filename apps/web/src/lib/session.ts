'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { Me, Permission } from '@nidhisetu/shared';
import { api } from './api-client';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/api/auth/me'),
    staleTime: 60_000,
    retry: false,
  });
}

export function can(me: Me | undefined, ...permissions: Permission[]): boolean {
  return !!me && permissions.some((p) => me.permissions.includes(p));
}

export function useSignOut() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    await api('/api/auth/logout', { method: 'POST', noRefresh: true }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
}
