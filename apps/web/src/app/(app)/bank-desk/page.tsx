'use client';

import type { BankRequestView, Paged } from '@nidhisetu/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Suspense } from 'react';
import { BANK_STATUS_TONE } from '@/components/instrument/bank-panel';
import { Card } from '@/components/ui/card';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';
import { useMe } from '@/lib/session';
import { useUrlState } from '@/lib/use-url-state';
import { cn, formatDate, formatInr } from '@/lib/utils';

export default function BankDeskPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const t = useTranslations('bank');
  const { data: me } = useMe();
  const [state, set] = useUrlState(['status'] as const);
  const status = state.status ?? 'PENDING';
  const { data, error, isLoading } = useQuery({
    queryKey: ['bank-requests', status],
    queryFn: () =>
      api<Paged<BankRequestView>>(
        `/api/bank-requests?pageSize=100${status === 'ALL' ? '' : `&status=${status}`}`,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const tabs = [
    { id: 'PENDING', label: t('pending') },
    { id: 'CONFIRMED', label: t('statuses.CONFIRMED') },
    { id: 'DENIED', label: t('statuses.DENIED') },
    { id: 'ALL', label: t('allRequests') },
  ];

  return (
    <>
      <PageHeader
        title={t('deskTitle')}
        description={t('deskSubtitle', { bank: me?.bankName ?? '' })}
      />
      <div role="tablist" aria-label={t('deskTitle')} className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={status === tab.id}
            onClick={() => set({ status: tab.id })}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset',
              status === tab.id
                ? 'bg-brand-700 text-white ring-brand-700'
                : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {error && <Alert tone="error">{errorMessage(error)}</Alert>}
      {isLoading || !data ? (
        <Skeleton className="h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="space-y-3">
          {data.items.map((r) => {
            const overdue = r.status === 'PENDING' && new Date(r.slaDueAt) < new Date();
            return (
              <li key={r.id}>
                <Link
                  href={`/bank-desk/${r.id}`}
                  className="block rounded-lg focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <Card className="flex items-center gap-4 p-4 hover:border-brand-600">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-slate-900">
                          {r.snapshot.fdrNumber}
                        </span>
                        <Badge tone={BANK_STATUS_TONE[r.status]}>{t(`statuses.${r.status}`)}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-700">
                        {r.snapshot.institutionName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatInr(r.snapshot.amount)} · {formatDate(r.snapshot.maturityDate)} ·{' '}
                        {r.snapshot.branch} ({r.snapshot.ifsc})
                      </p>
                      {r.status === 'PENDING' && (
                        <p
                          className={cn(
                            'mt-1 text-xs',
                            overdue ? 'font-semibold text-red-700' : 'text-slate-500',
                          )}
                        >
                          {overdue
                            ? t('overdue', { date: formatDate(r.slaDueAt) })
                            : t('due', { date: formatDate(r.slaDueAt) })}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                    <span className="sr-only">{t('open')}</span>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
