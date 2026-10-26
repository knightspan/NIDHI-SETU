'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api-client';

export function NotificationBell() {
  const t = useTranslations('nav');
  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ unread: number }>('/api/notifications/unread-count'),
    refetchInterval: 30_000,
    retry: false,
  });
  const unread = data?.unread ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative rounded-md p-2 text-slate-700 hover:bg-slate-100"
      aria-label={`${t('notifications')}${unread ? ` (${unread})` : ''}`}
    >
      <Bell className="h-5 w-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-red-700 px-1 text-center text-[11px] font-bold leading-5 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
