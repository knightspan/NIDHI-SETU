'use client';

import type {
  InstitutionSummaryView,
  LegacyBatchView,
  LegacyItemView,
  Paged,
} from '@nidhisetu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileSearch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { InstrumentForm } from '@/components/instrument-form';
import { documentUrl } from '@/components/instrument/documents-panel';
import { BatchProgress } from '@/components/legacy';
import { ocrToForm, useOcrHighlight } from '@/components/ocr-prefill';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api-client';
import { formatDateTime, formatInr } from '@/lib/utils';

const STATUS_TONE = { PENDING_REVIEW: 'amber', CONFIRMED: 'green', REJECTED: 'slate' } as const;

export default function LegacyBatchPage() {
  const t = useTranslations('legacy');
  const { id } = useParams<{ id: string }>();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['legacy', 'batch', id],
    queryFn: () => api<LegacyBatchView>(`/api/legacy/batches/${id}`),
    refetchInterval: (q) => ((q.state.data?.counts.ocrRunning ?? 0) > 0 ? 2000 : false),
  });

  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (isLoading || !data) return <Skeleton className="h-64" />;
  const item = data.items?.find((i) => i.id === selected) ?? null;

  return (
    <>
      <Link
        href="/legacy"
        className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t('title')}
      </Link>
      <PageHeader
        title={data.label}
        description={t('batchSubtitle', {
          region: data.regionName,
          files: data.fileCount,
          date: formatDateTime(data.createdAt),
        })}
        actions={<BatchProgress counts={data.counts} />}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t('items')} description={t('itemsHint')} />
          <CardBody>
            {!data.items?.length ? (
              <EmptyState title={t('noItems')} />
            ) : (
              <Table caption={t('items')}>
                <THead>
                  <tr>
                    <TH>{t('colFile')}</TH>
                    <TH>{t('colExtracted')}</TH>
                    <TH>{t('colSuggested')}</TH>
                    <TH>{t('colStatus')}</TH>
                    <TH>
                      <span className="sr-only">{t('colActions')}</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {data.items.map((i) => (
                    <TR key={i.id} className={i.id === selected ? 'bg-brand-50' : undefined}>
                      <TD className="max-w-56 truncate font-medium">{i.fileName}</TD>
                      <TD className="text-sm">
                        <Extracted item={i} />
                      </TD>
                      <TD className="text-sm">
                        {i.suggestedInstitution ? (
                          <>
                            {i.suggestedInstitution.name}
                            <div className="text-xs text-slate-500">
                              {i.suggestedInstitution.aicteId}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={STATUS_TONE[i.status]}>{t(`itemStatus.${i.status}`)}</Badge>
                      </TD>
                      <TD className="text-right">
                        {i.status === 'PENDING_REVIEW' ? (
                          <Button
                            size="sm"
                            variant={i.id === selected ? 'primary' : 'secondary'}
                            onClick={() => setSelected(i.id)}
                          >
                            <FileSearch className="h-4 w-4" aria-hidden />
                            {t('review')}
                          </Button>
                        ) : i.instrumentId ? (
                          <Link
                            href={`/instruments/${i.instrumentId}`}
                            className="font-mono text-sm text-brand-700 hover:underline"
                          >
                            {i.instrumentRefNo}
                          </Link>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
        {item && item.status === 'PENDING_REVIEW' && (
          <ReviewPanel key={item.id} item={item} onDone={() => setSelected(null)} />
        )}
      </div>
    </>
  );
}

function Extracted({ item }: { item: LegacyItemView }) {
  const t = useTranslations('legacy');
  if (item.ocrError) return <span className="text-amber-800">{t('ocrFailed')}</span>;
  if (!item.ocr) return <span className="text-slate-500">{t('ocrPending')}</span>;
  const f = item.ocr.fields;
  return (
    <div>
      <div className="font-mono">{f.fdrNumber ?? '—'}</div>
      <div className="text-xs text-slate-600">
        {[f.bankCode, f.amount ? formatInr(f.amount) : null].filter(Boolean).join(' · ')}
        {item.ocr.lowConfidence.length > 0 && (
          <span className="ml-1 text-amber-800">
            {t('lowFields', { count: item.ocr.lowConfidence.length })}
          </span>
        )}
      </div>
    </div>
  );
}

function ReviewPanel({ item, onDone }: { item: LegacyItemView; onDone: () => void }) {
  const t = useTranslations('legacy');
  const qc = useQueryClient();
  const highlight = useOcrHighlight();
  const [url, setUrl] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState(item.suggestedInstitution?.id ?? '');
  const [instError, setInstError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: institutions } = useQuery({
    queryKey: ['institutions', 'region-all'],
    queryFn: () => api<Paged<InstitutionSummaryView>>('/api/institutions?pageSize=200'),
  });

  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  useEffect(() => {
    documentUrl(item.documentId, true)
      .then(setUrl)
      .catch((e: unknown) => toast.error(errorMessage(e)));
  }, [item.documentId]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['legacy'] });

  return (
    <Card ref={panel} tabIndex={-1} className="scroll-mt-4">
      <CardHeader title={t('reviewTitle', { file: item.fileName })} description={t('reviewHint')} />
      <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-h-96 self-start overflow-hidden rounded-md border border-slate-200 bg-slate-50 lg:sticky lg:top-4">
          {!url ? (
            <Skeleton className="h-96" />
          ) : item.mimeType === 'application/pdf' ? (
            <iframe src={url} title={item.fileName} className="h-[36rem] w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL
            <img src={url} alt={t('scanAlt', { file: item.fileName })} className="w-full" />
          )}
        </div>
        <div className="space-y-4">
          {item.ocrError && <Alert tone="warning">{t('ocrFailedHint')}</Alert>}
          <Field
            label={t('institution')}
            error={instError}
            hint={item.suggestedInstitution ? t('suggestedHint') : undefined}
            required
          >
            {(p) => (
              <Select
                {...p}
                value={institutionId}
                onChange={(e) => {
                  setInstitutionId(e.target.value);
                  setInstError(undefined);
                }}
              >
                <option value="">{t('chooseInstitution')}</option>
                {institutions?.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.aicteId})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <InstrumentForm
            initial={item.ocr ? ocrToForm(item.ocr) : undefined}
            highlight={highlight(item.ocr)}
            submitLabel={t('confirm')}
            onSubmit={async (declaration) => {
              if (!institutionId) {
                setInstError(t('chooseInstitution'));
                throw new Error(t('chooseInstitution'));
              }
              const r = await api<{ instrumentId: string; refNo: string }>(
                `/api/legacy/items/${item.id}/confirm`,
                { body: { institutionId, declaration } },
              );
              toast.success(t('confirmedToast', { refNo: r.refNo }));
              await refresh();
              onDone();
            }}
          />
          <div className="flex justify-start border-t border-slate-100 pt-4">
            <Button variant="ghost" onClick={() => setRejecting(true)}>
              {t('reject')}
            </Button>
          </div>
        </div>
      </CardBody>
      <ConfirmDialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={t('rejectTitle')}
        description={t('rejectHint')}
        confirmLabel={t('reject')}
        variant="danger"
        note={{ label: t('rejectReason'), required: true, minLength: 3 }}
        loading={busy}
        onConfirm={(note) => {
          setBusy(true);
          api(`/api/legacy/items/${item.id}/reject`, { body: { note } })
            .then(async () => {
              toast.success(t('rejectedToast'));
              setRejecting(false);
              await refresh();
              onDone();
            })
            .catch((e: unknown) => toast.error(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      />
    </Card>
  );
}
