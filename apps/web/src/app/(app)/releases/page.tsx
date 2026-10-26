'use client';

import type { Paged, ReleaseView } from '@nidhisetu/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { RELEASE_TONE } from '@/components/instrument/release-panel';
import { Card, CardBody } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { formatDate, formatInr } from '@/lib/utils';

export default function ReleasesPage() {
  const t = useTranslations('releases');
  const [open, setOpen] = useState('true');
  const { data, isLoading } = useQuery({
    queryKey: ['releases', open],
    queryFn: () => api<Paged<ReleaseView>>(`/api/releases?pageSize=100&open=${open}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card>
        <CardBody className="space-y-4">
          <div className="w-48">
            <Select
              aria-label={t('colStatus')}
              value={open}
              onChange={(e) => setOpen(e.target.value)}
            >
              <option value="true">{t('openOnly')}</option>
              <option value="false">{t('all')}</option>
            </Select>
          </div>
          {isLoading || !data ? (
            <Skeleton className="h-40" />
          ) : data.items.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <Table caption={t('title')}>
              <THead>
                <tr>
                  <TH>{t('colInstrument')}</TH>
                  <TH className="text-right">{t('colAmount')}</TH>
                  <TH>{t('colStatus')}</TH>
                  <TH>{t('colChecklist')}</TH>
                  <TH>{t('colRequested')}</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Link
                        href={`/instruments/${r.instrumentId}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {r.refNo}
                      </Link>
                      <div className="max-w-64 truncate text-xs text-slate-500">
                        {r.institutionName}
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums">{formatInr(r.amount)}</TD>
                    <TD>
                      <Badge tone={RELEASE_TONE[r.status]}>{t(`statuses.${r.status}`)}</Badge>
                    </TD>
                    <TD>
                      {r.checklistPassed ? (
                        <CheckCircle2
                          className="h-4 w-4 text-green-700"
                          aria-label={t('checklistPassed')}
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-700">
                          <XCircle className="h-4 w-4" aria-hidden />
                          {t('checklistFailed', {
                            count: r.checklist.filter((c) => !c.passed).length,
                          })}
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(r.requestedAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
