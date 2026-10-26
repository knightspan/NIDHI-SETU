'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { api } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/utils';

interface Escalation {
  id: string;
  entityType: string;
  instrumentId: string | null;
  refNo: string | null;
  institutionName: string | null;
  level: number;
  toRole: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
}

export default function EscalationsPage() {
  const t = useTranslations();
  const [open, setOpen] = useState('true');
  const { data, isLoading } = useQuery({
    queryKey: ['escalations', open],
    queryFn: () =>
      api<{ items: Escalation[]; total: number }>(`/api/escalations?pageSize=100&open=${open}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title={t('escalations.title')} description={t('escalations.subtitle')} />
      <div className="mb-3 w-48">
        <Select
          aria-label={t('common.status')}
          value={open}
          onChange={(e) => setOpen(e.target.value)}
        >
          <option value="true">{t('escalations.openOnly')}</option>
          <option value="false">{t('escalations.all')}</option>
        </Select>
      </div>
      {isLoading || !data ? (
        <Skeleton className="h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState title={t('escalations.empty')} />
      ) : (
        <ul className="space-y-2">
          {data.items.map((e) => (
            <li key={e.id}>
              <Card className="flex gap-3 p-4">
                <ShieldAlert
                  className={e.level >= 2 ? 'h-5 w-5 text-red-700' : 'h-5 w-5 text-amber-600'}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {t.has(`escalations.types.${e.entityType}`)
                        ? t(`escalations.types.${e.entityType}`)
                        : e.entityType}
                    </span>
                    <Badge tone={e.level >= 3 ? 'red' : e.level === 2 ? 'amber' : 'slate'}>
                      {t('escalations.level', { level: e.level })}
                    </Badge>
                    <Badge tone="brand">
                      {t('escalations.to', { role: t(`roles.${e.toRole}`) })}
                    </Badge>
                    {e.resolvedAt && (
                      <Badge tone="green">
                        {t('escalations.resolved', { date: formatDate(e.resolvedAt) })}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{e.reason}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {e.instrumentId && (
                      <Link
                        href={`/instruments/${e.instrumentId}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {e.refNo}
                      </Link>
                    )}
                    {e.institutionName && ` · ${e.institutionName}`} · {formatDateTime(e.createdAt)}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
