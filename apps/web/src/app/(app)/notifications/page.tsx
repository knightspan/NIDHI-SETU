'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Mail, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api-client';
import { cn, formatDateTime } from '@/lib/utils';

interface Note {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  channels: string[];
  readAt: string | null;
  createdAt: string;
}

const KIND_TONE: Record<string, 'red' | 'amber' | 'blue' | 'green' | 'purple' | 'slate'> = {
  ESCALATION: 'red',
  DISCREPANCY: 'red',
  REMINDER: 'amber',
  BANK: 'blue',
  ACTIVATED: 'green',
  RELEASE: 'purple',
  RENEWAL: 'purple',
};

export default function NotificationsPage() {
  const t = useTranslations('notifications');
  const qc = useQueryClient();
  const [unread, setUnread] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list', unread],
    queryFn: () =>
      api<{ items: Note[]; total: number }>(
        `/api/notifications?pageSize=100${unread ? '&unread=true' : ''}`,
      ),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({
    mutationFn: () => api('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: refresh,
  });
  const readOne = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: refresh,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button variant="secondary" onClick={() => readAll.mutate()} loading={readAll.isPending}>
            <CheckCheck className="h-4 w-4" aria-hidden />
            {t('markAll')}
          </Button>
        }
      />
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand-700"
          checked={unread}
          onChange={(e) => setUnread(e.target.checked)}
        />
        {t('unreadOnly')}
      </label>
      {isLoading || !data ? (
        <Skeleton className="h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-2">
          {data.items.map((n) => (
            <li key={n.id}>
              <Card className={cn('p-4', !n.readAt && 'border-l-4 border-l-brand-600')}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONE[n.kind] ?? 'slate'}>
                    {t.has(`kinds.${n.kind}`) ? t(`kinds.${n.kind}`) : n.kind}
                  </Badge>
                  <h2
                    className={cn(
                      'text-sm',
                      n.readAt ? 'text-slate-700' : 'font-semibold text-slate-900',
                    )}
                  >
                    {n.link ? (
                      <Link
                        href={n.link}
                        className="hover:underline"
                        onClick={() => !n.readAt && readOne.mutate(n.id)}
                      >
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </h2>
                  <span className="ml-auto text-xs text-slate-500">
                    {formatDateTime(n.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm whitespace-pre-line text-slate-700">{n.body}</p>
                <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                  {n.channels.includes('EMAIL') && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                      {t('viaEmail')}
                    </span>
                  )}
                  {n.channels.includes('SMS') && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                      {t('viaSms')}
                    </span>
                  )}
                  {!n.readAt && (
                    <Button
                      size="sm"
                      variant="link"
                      className="ml-auto h-auto"
                      onClick={() => readOne.mutate(n.id)}
                    >
                      {t('markRead')}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
