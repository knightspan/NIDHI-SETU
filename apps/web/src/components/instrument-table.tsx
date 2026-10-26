'use client';

import type { InstrumentSummary, Paged } from '@nidhisetu/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { StatusBadge, TrustScore, ValidityBadge } from '@/components/badges';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Skeleton } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api-client';
import { formatDate, formatInr } from '@/lib/utils';

export type InstrumentQuery = Record<string, string | number | undefined>;

export function toSearch(q: InstrumentQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export function useInstruments(q: InstrumentQuery) {
  return useQuery({
    queryKey: ['instruments', q],
    queryFn: () => api<Paged<InstrumentSummary>>(`/api/instruments?${toSearch(q)}`),
    placeholderData: keepPreviousData,
  });
}

export function InstrumentTable({
  query,
  onPage,
  showInstitution = true,
  emptyText,
  caption,
}: {
  query: InstrumentQuery;
  onPage?: (page: number) => void;
  showInstitution?: boolean;
  emptyText?: string;
  caption: string;
}) {
  const t = useTranslations();
  const { data, isLoading, error } = useInstruments(query);

  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (isLoading || !data) {
    return (
      <div className="space-y-2" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (data.items.length === 0) return <EmptyState title={emptyText ?? t('instruments.empty')} />;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600" aria-live="polite">
        {t('instruments.results', { count: data.total })}
      </p>
      <Table caption={caption}>
        <THead>
          <tr>
            <TH>{t('instruments.colRef')}</TH>
            {showInstitution && <TH>{t('instruments.colInstitution')}</TH>}
            <TH>{t('instruments.colBank')}</TH>
            <TH className="text-right">{t('instruments.colAmount')}</TH>
            <TH>{t('instruments.colMaturity')}</TH>
            <TH>{t('instruments.colStatus')}</TH>
            <TH>{t('instruments.colValidity')}</TH>
            <TH>{t('instruments.colTrust')}</TH>
          </tr>
        </THead>
        <TBody>
          {data.items.map((i) => (
            <TR key={i.id}>
              <TD>
                <Link
                  href={`/instruments/${i.id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {i.refNo}
                </Link>
                <div className="font-mono text-xs text-slate-500">{i.fdrNumber ?? '—'}</div>
                {(i.mismatchCount > 0 || i.openDiscrepancies > 0) && (
                  <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-red-700">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {i.openDiscrepancies > 0
                      ? t('instruments.openDiscrepancies', { count: i.openDiscrepancies })
                      : t('instruments.mismatches', { count: i.mismatchCount })}
                  </div>
                )}
              </TD>
              {showInstitution && (
                <TD className="max-w-64">
                  <div className="truncate" title={i.institution.name}>
                    {i.institution.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {i.institution.aicteId} · {i.institution.regionName}
                  </div>
                </TD>
              )}
              <TD>{i.bankName ?? i.bankCode ?? '—'}</TD>
              <TD className="text-right tabular-nums">{formatInr(i.amount)}</TD>
              <TD className="whitespace-nowrap">{formatDate(i.maturityDate)}</TD>
              <TD>
                <StatusBadge status={i.status} />
              </TD>
              <TD>
                <ValidityBadge validity={i.validityStatus} />
              </TD>
              <TD>
                <TrustScore score={i.trustScore} compact />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {pages > 1 && onPage && (
        <nav className="flex items-center justify-end gap-2" aria-label="Pagination">
          <Button
            variant="secondary"
            size="sm"
            disabled={data.page <= 1}
            onClick={() => onPage(data.page - 1)}
          >
            {t('common.previous')}
          </Button>
          <span className="text-sm text-slate-600">
            {t('common.page', { page: data.page, pages })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={data.page >= pages}
            onClick={() => onPage(data.page + 1)}
          >
            {t('common.next')}
          </Button>
        </nav>
      )}
    </div>
  );
}
