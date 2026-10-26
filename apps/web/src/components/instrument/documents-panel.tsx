'use client';

import { DOCUMENT_TYPES, type DocumentView, type InstrumentDetail } from '@nidhisetu/shared';
import { Download, Eye, FileText, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { Badge, Dialog, EmptyState } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';
import { useInstrumentAction } from './use-instrument';

export async function documentUrl(id: string, inline: boolean): Promise<string> {
  const r = await api<{ url: string }>(`/api/documents/${id}/url?inline=${inline}`);
  return r.url;
}

export function DocumentsPanel({
  inst,
  onPreview,
}: {
  inst: InstrumentDetail;
  onPreview?: (d: DocumentView) => void;
}) {
  const t = useTranslations();
  const canUpload = inst.allowedActions.includes('upload');
  const [preview, setPreview] = useState<{ doc: DocumentView; url: string } | null>(null);

  const open = async (d: DocumentView) => {
    if (onPreview) return onPreview(d);
    try {
      setPreview({ doc: d, url: await documentUrl(d.id, true) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const download = async (d: DocumentView) => {
    try {
      window.open(await documentUrl(d.id, false), '_blank', 'noopener');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader title={t('instruments.documents')} />
      <CardBody className="space-y-4">
        {inst.documents.length === 0 ? (
          <EmptyState title={t('instruments.noDocuments')} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {inst.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                <FileText className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {t(`docTypes.${d.type}`)}{' '}
                    <span className="font-normal text-slate-500">· {d.originalName}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('instruments.uploadedBy', {
                      who: d.uploadedBy ?? '—',
                      when: formatDateTime(d.createdAt),
                    })}{' '}
                    ·{' '}
                    <span className="font-mono" title={d.sha256}>
                      sha256 {d.sha256.slice(0, 10)}…
                    </span>
                  </p>
                </div>
                <Badge tone={d.supersededBy ? 'slate' : 'brand'}>
                  {t('instruments.version', { version: d.version })}
                  {d.supersededBy && ` · ${t('instruments.superseded')}`}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void open(d)}
                  aria-label={`${t('instruments.preview')}: ${d.originalName}`}
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{t('instruments.preview')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void download(d)}
                  aria-label={`${t('common.download')}: ${d.originalName}`}
                >
                  <Download className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {canUpload && <UploadForm instrumentId={inst.id} />}
      </CardBody>
      <Dialog
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.doc.originalName ?? ''}
        wide
      >
        {preview && (
          <DocumentViewer
            url={preview.url}
            mimeType={preview.doc.mimeType}
            title={preview.doc.originalName}
          />
        )}
      </Dialog>
    </Card>
  );
}

export function DocumentViewer({
  url,
  mimeType,
  title,
  className,
}: {
  url: string;
  mimeType: string;
  title: string;
  className?: string;
}) {
  return mimeType === 'application/pdf' ? (
    <iframe src={url} title={title} className={className ?? 'h-[70vh] w-full rounded border'} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL
    <img src={url} alt={title} className={className ?? 'mx-auto max-h-[70vh] rounded border'} />
  );
}

function UploadForm({ instrumentId }: { instrumentId: string }) {
  const t = useTranslations();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<string>('FDR_SCAN');
  const action = useInstrumentAction(instrumentId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return fileRef.current?.focus();
    const fd = new FormData();
    fd.set('type', type);
    fd.set('file', file);
    action.mutate(
      {
        path: `/api/instruments/${instrumentId}/documents`,
        formData: fd,
        success: t('instruments.uploaded'),
      },
      { onSuccess: () => fileRef.current && (fileRef.current.value = '') },
    );
  };

  return (
    <form onSubmit={submit} className="rounded-md border border-dashed border-slate-300 p-3">
      <p className="mb-2 text-sm font-semibold text-slate-800">{t('instruments.uploadTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <Field label={t('instruments.docType')}>
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value)}>
              {DOCUMENT_TYPES.map((d) => (
                <option key={d} value={d}>
                  {t(`docTypes.${d}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('instruments.chooseFile')}>
          {(p) => (
            <input
              {...p}
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-900"
            />
          )}
        </Field>
        <Button type="submit" loading={action.isPending}>
          <Upload className="h-4 w-4" aria-hidden />
          {t('common.upload')}
        </Button>
      </div>
    </form>
  );
}
