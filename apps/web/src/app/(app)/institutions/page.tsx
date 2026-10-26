'use client';

import type { InstitutionSummaryView, Paged } from '@nidhisetu/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { ComplianceBadge } from '@/components/compliance-badge';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { useRegions } from '@/lib/master-data';
import { useMe } from '@/lib/session';
import { useUrlState } from '@/lib/use-url-state';
import { formatInr } from '@/lib/utils';

export default function InstitutionsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const t = useTranslations();
  const { data: me } = useMe();
  const { regions } = useRegions();
  const [state, set] = useUrlState(['q', 'regionId', 'compliance', 'page'] as const);
  const [q, setQ] = useState(state.q ?? '');
  useEffect(() => {
    const h = setTimeout(() => (state.q ?? '') !== q && set({ q }), 300);
    return () => clearTimeout(h);
  }, [q, state.q, set]);
  const params = new URLSearchParams(
    Object.entries({ ...state, pageSize: '25' }).filter(([, v]) => v) as [string, string][],
  );
  const { data, isLoading } = useQuery({
    queryKey: ['institutions', params.toString()],
    queryFn: () => api<Paged<InstitutionSummaryView>>(`/api/institutions?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title={t('institutions.title')} description={t('institutions.subtitle')} />
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4" role="search">
            <div className="relative sm:col-span-2">
              <Search
                className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
                aria-hidden
              />
              <Input
                aria-label={t('common.search')}
                placeholder={t('institutions.search')}
                className="pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {me?.role !== 'RO_OFFICER' && (
              <Select
                aria-label={t('fields.region')}
                value={state.regionId ?? ''}
                onChange={(e) => set({ regionId: e.target.value })}
              >
                <option value="">{t('instruments.anyRegion')}</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
            <Select
              aria-label={t('institutions.colStatus')}
              value={state.compliance ?? ''}
              onChange={(e) => set({ compliance: e.target.value })}
            >
              <option value="">{t('institutions.anyCompliance')}</option>
              <option value="shortfall">{t('institutions.shortfall')}</option>
              <option value="compliant">{t('institutions.compliant')}</option>
              <option value="exempt">{t('institutions.exempt')}</option>
            </Select>
          </div>
          {isLoading || !data ? (
            <Skeleton className="h-60" />
          ) : data.items.length === 0 ? (
            <EmptyState title={t('institutions.empty')} />
          ) : (
            <>
              <Table caption={t('institutions.title')}>
                <THead>
                  <tr>
                    <TH>{t('institutions.colInstitution')}</TH>
                    <TH>{t('institutions.colRegion')}</TH>
                    <TH className="text-right">{t('institutions.colHeld')}</TH>
                    <TH className="text-right">{t('institutions.colRequired')}</TH>
                    <TH>{t('institutions.colStatus')}</TH>
                    <TH className="text-right">{t('institutions.colOpen')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.items.map((i) => (
                    <TR key={i.id}>
                      <TD>
                        <Link
                          href={`/institutions/${i.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {i.name}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {i.aicteId} · {i.state} ·{' '}
                          {t('instruments.established', { year: i.yearEstablished })}
                        </div>
                      </TD>
                      <TD>{i.regionName}</TD>
                      <TD className="text-right tabular-nums">
                        {formatInr(i.heldAmount)}
                        <div className="text-xs text-slate-500">
                          {t('dashboard.kpi.heldCount', { count: i.heldCount })}
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums">
                        {i.exempt ? '—' : formatInr(i.required)}
                      </TD>
                      <TD>
                        <ComplianceBadge i={i} />
                      </TD>
                      <TD className="text-right tabular-nums">{i.openDiscrepancies || '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {pages > 1 && (
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={data.page <= 1}
                    onClick={() => set({ page: String(data.page - 1) }, false)}
                  >
                    {t('common.previous')}
                  </Button>
                  <span className="text-sm text-slate-600">
                    {t('common.page', { page: data.page, pages })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={data.page >= pages}
                    onClick={() => set({ page: String(data.page + 1) }, false)}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
