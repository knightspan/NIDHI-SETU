'use client';

import {
  REPORT_FORMATS,
  REPORT_TYPES,
  type InstitutionSummaryView,
  type Paged,
  type ReportType,
} from '@nidhisetu/shared';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api-client';

interface ReportTable {
  title: string;
  subtitle: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
}

export default function ReportsPage() {
  const t = useTranslations('reports');
  const [type, setType] = useState<ReportType>('pending-verifications');
  const [days, setDays] = useState('90');
  const [institutionId, setInstitutionId] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const { data: institutions } = useQuery({
    queryKey: ['institutions', 'all-for-reports'],
    queryFn: () => api<Paged<InstitutionSummaryView>>('/api/institutions?pageSize=200'),
    enabled: type === 'institution-statement',
  });
  const query = new URLSearchParams({
    days,
    ...(type === 'institution-statement' && institutionId ? { institutionId } : {}),
  });
  const ready = type !== 'institution-statement' || !!institutionId;
  const { data, isFetching, error } = useQuery({
    queryKey: ['report-preview', preview],
    queryFn: () => api<ReportTable>(preview!),
    enabled: !!preview,
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card>
        <CardBody className="grid items-end gap-3 sm:grid-cols-4">
          <Field label={t('title')} className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={type} onChange={(e) => setType(e.target.value as ReportType)}>
                {REPORT_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {t(`names.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {type === 'upcoming-maturities' && (
            <Field label={t('days')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={3650}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              )}
            </Field>
          )}
          {type === 'institution-statement' && (
            <Field label={t('institution')}>
              {(p) => (
                <Select
                  {...p}
                  value={institutionId}
                  onChange={(e) => setInstitutionId(e.target.value)}
                >
                  <option value="" />
                  {institutions?.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-4">
            <Button
              variant="secondary"
              disabled={!ready}
              onClick={() => setPreview(`/api/reports/${type}/preview?${query.toString()}`)}
            >
              <Eye className="h-4 w-4" aria-hidden />
              {t('preview')}
            </Button>
            {REPORT_FORMATS.map((f) => (
              <a
                key={f}
                aria-disabled={!ready}
                href={ready ? `/api/reports/${type}?format=${f}&${query.toString()}` : undefined}
                className={buttonVariants({
                  variant: 'secondary',
                  className: !ready ? 'pointer-events-none opacity-50' : '',
                })}
              >
                <Download className="h-4 w-4" aria-hidden />
                {f.toUpperCase()}
              </a>
            ))}
          </div>
        </CardBody>
      </Card>
      {error && <Alert tone="error">{errorMessage(error)}</Alert>}
      {preview && (
        <Card>
          {isFetching || !data ? (
            <CardBody>
              <Spinner />
            </CardBody>
          ) : (
            <>
              <CardHeader
                title={data.title}
                description={`${data.subtitle} · ${t('rows', { count: data.rows.length })}`}
              />
              <CardBody className="p-0 sm:p-0">
                {data.rows.length === 0 ? (
                  <div className="p-4">
                    <EmptyState title="—" />
                  </div>
                ) : (
                  <Table caption={data.title}>
                    <THead>
                      <tr>
                        {data.columns.map((c) => (
                          <TH key={c.key} className={c.numeric ? 'text-right' : undefined}>
                            {c.label}
                          </TH>
                        ))}
                      </tr>
                    </THead>
                    <TBody>
                      {data.rows.slice(0, 200).map((r, i) => (
                        <TR key={i}>
                          {data.columns.map((c) => (
                            <TD
                              key={c.key}
                              className={c.numeric ? 'text-right tabular-nums' : undefined}
                            >
                              {typeof r[c.key] === 'number' && c.key === 'amount'
                                ? (r[c.key] as number).toLocaleString('en-IN')
                                : (r[c.key] ?? '—')}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
