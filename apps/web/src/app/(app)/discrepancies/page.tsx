'use client';

import { SEVERITIES, type DiscrepancyView, type Paged } from '@nidhisetu/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertOctagon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Suspense } from 'react';
import { SEVERITY_TONE } from '@/components/instrument/discrepancies-panel';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api-client';
import { useUrlState } from '@/lib/use-url-state';
import { formatDate } from '@/lib/utils';

export default function DiscrepanciesPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const t = useTranslations();
  const [state, set] = useUrlState(['open', 'severity', 'ruleCode', 'page'] as const);
  const open = state.open ?? 'true';
  const params = new URLSearchParams({
    ...(open === 'true' ? { open: 'true' } : {}),
    ...(state.severity ? { severity: state.severity } : {}),
    ...(state.ruleCode ? { ruleCode: state.ruleCode } : {}),
    page: state.page ?? '1',
    pageSize: '25',
  });
  const { data, error, isLoading } = useQuery({
    queryKey: ['discrepancies', params.toString()],
    queryFn: () => api<Paged<DiscrepancyView>>(`/api/discrepancies?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const ruleLabel = (c: string) =>
    t.has(`discrepancies.rules.${c}`) ? t(`discrepancies.rules.${c}`) : c;

  return (
    <>
      <PageHeader title={t('discrepancies.title')} description={t('discrepancies.subtitle')} />
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              aria-label={t('discrepancies.colStatus')}
              value={open}
              onChange={(e) => set({ open: e.target.value })}
            >
              <option value="true">{t('discrepancies.openOnly')}</option>
              <option value="false">{t('discrepancies.allStatuses')}</option>
            </Select>
            <Select
              aria-label={t('discrepancies.colSeverity')}
              value={state.severity ?? ''}
              onChange={(e) => set({ severity: e.target.value })}
            >
              <option value="">{t('discrepancies.anySeverity')}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`severity.${s}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('discrepancies.colRule')}
              value={state.ruleCode ?? ''}
              onChange={(e) => set({ ruleCode: e.target.value })}
            >
              <option value="">{t('common.all')}</option>
              {[
                'DUPLICATE_FDR',
                'FIELD_MISMATCH',
                'AMOUNT_BELOW_REQUIRED',
                'MATURITY_BEFORE_REQUIRED_END',
                'NOT_JOINT_NAME',
                'LIEN_NOT_MARKED',
                'DUPLICATE_DOCUMENT',
                'INVALID_IFSC',
                'UNKNOWN_BANK',
                'MISSING_DOCUMENT',
                'MANUAL',
                'BANK_DENIED',
              ].map((c) => (
                <option key={c} value={c}>
                  {ruleLabel(c)}
                </option>
              ))}
            </Select>
          </div>
          {error && <Alert tone="error">{errorMessage(error)}</Alert>}
          {isLoading || !data ? (
            <Skeleton className="h-40" />
          ) : data.items.length === 0 ? (
            <EmptyState title={t('discrepancies.empty')} />
          ) : (
            <>
              <Table caption={t('discrepancies.title')}>
                <THead>
                  <tr>
                    <TH>{t('discrepancies.colRule')}</TH>
                    <TH>{t('discrepancies.colInstrument')}</TH>
                    <TH>{t('discrepancies.colDescription')}</TH>
                    <TH>{t('discrepancies.colSeverity')}</TH>
                    <TH>{t('discrepancies.colStatus')}</TH>
                    <TH>{t('discrepancies.colRaised')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.items.map((d) => (
                    <TR
                      key={d.id}
                      className={d.ruleCode === 'DUPLICATE_FDR' ? 'bg-red-50/60' : undefined}
                    >
                      <TD className="whitespace-nowrap font-medium">
                        {d.ruleCode === 'DUPLICATE_FDR' && (
                          <AlertOctagon className="mr-1 inline h-4 w-4 text-red-700" aria-hidden />
                        )}
                        {ruleLabel(d.ruleCode)}
                      </TD>
                      <TD>
                        <Link
                          href={`/instruments/${d.instrumentId}#discrepancies`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {d.refNo}
                        </Link>
                        <div className="max-w-56 truncate text-xs text-slate-500">
                          {d.institutionName}
                        </div>
                      </TD>
                      <TD className="max-w-md text-sm">{d.description}</TD>
                      <TD>
                        <Badge tone={SEVERITY_TONE[d.severity]}>
                          {t(`severity.${d.severity}`)}
                        </Badge>
                      </TD>
                      <TD>{t(`discrepancyStatus.${d.status}`)}</TD>
                      <TD className="whitespace-nowrap">{formatDate(d.createdAt)}</TD>
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
