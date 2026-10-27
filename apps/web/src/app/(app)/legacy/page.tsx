'use client';

import type { LegacyBatchView, ReconciliationReport } from '@nidhisetu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { BatchProgress, KIND_TONE } from '@/components/legacy';
import { Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

export default function LegacyPage() {
  const t = useTranslations('legacy');
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="space-y-6">
        <UploadCard />
        <BatchesCard />
        <ReconciliationCard />
      </div>
    </>
  );
}

function UploadCard() {
  const t = useTranslations('legacy');
  const router = useRouter();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('label', label.trim() || t('defaultLabel'));
      for (const f of files) fd.append('files', f);
      const b = await api<LegacyBatchView>('/api/legacy/batches', { formData: fd });
      await qc.invalidateQueries({ queryKey: ['legacy'] });
      toast.success(t('uploaded', { count: b.fileCount }));
      router.push(`/legacy/${b.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t('uploadTitle')} description={t('uploadHint')} />
      <CardBody>
        <form onSubmit={(e) => void upload(e)} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <Field label={t('batchLabel')}>
            {(p) => (
              <Input
                {...p}
                value={label}
                maxLength={120}
                placeholder={t('defaultLabel')}
                onChange={(e) => setLabel(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('files')}
            hint={files.length ? t('filesChosen', { count: files.length }) : t('filesHint')}
          >
            {(p) => (
              <input
                {...p}
                ref={input}
                type="file"
                multiple
                accept="application/pdf,image/png,image/jpeg,application/zip,.zip"
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            )}
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={busy} disabled={!files.length}>
              <Upload className="h-4 w-4" aria-hidden />
              {t('upload')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function BatchesCard() {
  const t = useTranslations('legacy');
  const { data, isLoading } = useQuery({
    queryKey: ['legacy', 'batches'],
    queryFn: () => api<LegacyBatchView[]>('/api/legacy/batches'),
    refetchInterval: (q) => (q.state.data?.some((b) => b.counts.ocrRunning > 0) ? 3000 : false),
  });
  return (
    <Card>
      <CardHeader title={t('batches')} />
      <CardBody>
        {isLoading || !data ? (
          <Skeleton className="h-24" />
        ) : data.length === 0 ? (
          <EmptyState title={t('noBatches')} />
        ) : (
          <Table caption={t('batches')}>
            <THead>
              <tr>
                <TH>{t('colBatch')}</TH>
                <TH>{t('colUploaded')}</TH>
                <TH className="text-right">{t('colFiles')}</TH>
                <TH>{t('colProgress')}</TH>
              </tr>
            </THead>
            <TBody>
              {data.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <Link
                      href={`/legacy/${b.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {b.label}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap">{formatDateTime(b.createdAt)}</TD>
                  <TD className="text-right tabular-nums">{b.fileCount}</TD>
                  <TD>
                    <BatchProgress counts={b.counts} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

function ReconciliationCard() {
  const t = useTranslations('legacy');
  const { data, isLoading } = useQuery({
    queryKey: ['legacy', 'reconciliation'],
    queryFn: () => api<ReconciliationReport>('/api/legacy/reconciliation'),
  });
  const kinds = ['MISSING', 'EXPIRED', 'MISMATCHED', 'DUPLICATED', 'UNREVIEWED'] as const;
  return (
    <Card>
      <CardHeader
        title={t('reconciliation')}
        description={data ? t('reconciliationHint', { region: data.regionName }) : undefined}
        actions={
          <a
            href="/api/legacy/reconciliation?format=csv"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('exportCsv')}
          </a>
        }
      />
      <CardBody className="space-y-4">
        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {kinds.map((k) => (
                <div key={k} className="rounded-md border border-slate-200 p-3">
                  <dt className="text-xs font-medium text-slate-600">{t(`kinds.${k}`)}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                    {data.counts[k]}
                  </dd>
                </div>
              ))}
            </dl>
            {data.rows.length === 0 ? (
              <EmptyState title={t('allReconciled')} />
            ) : (
              <Table caption={t('reconciliation')}>
                <THead>
                  <tr>
                    <TH>{t('colFinding')}</TH>
                    <TH>{t('colInstitution')}</TH>
                    <TH>{t('colReference')}</TH>
                    <TH>{t('colDetail')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.rows.map((r, i) => (
                    <TR key={`${r.kind}-${r.instrumentId ?? r.institutionId ?? i}-${i}`}>
                      <TD>
                        <Badge tone={KIND_TONE[r.kind]}>{t(`kinds.${r.kind}`)}</Badge>
                      </TD>
                      <TD>
                        {r.institutionId ? (
                          <Link
                            href={`/institutions/${r.institutionId}`}
                            className="text-brand-700 hover:underline"
                          >
                            {r.institutionName}
                          </Link>
                        ) : (
                          '—'
                        )}
                        {r.aicteId && <div className="text-xs text-slate-500">{r.aicteId}</div>}
                      </TD>
                      <TD>
                        {r.instrumentId ? (
                          <Link
                            href={`/instruments/${r.instrumentId}`}
                            className="font-mono text-sm text-brand-700 hover:underline"
                          >
                            {r.refNo}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD className="max-w-md text-sm text-slate-700">{r.detail}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
