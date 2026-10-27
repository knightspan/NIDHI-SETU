'use client';

import type { FieldKey, OcrPreview } from '@nidhisetu/shared';
import { ScanText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toFormValues, type FormValues } from '@/components/instrument-form';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';

const FORM_KEYS = new Set<string>([
  'type',
  'bankCode',
  'branch',
  'ifsc',
  'fdrNumber',
  'amount',
  'issueDate',
  'maturityDate',
  'depositorNames',
]);

/** Form values from an OCR preview (only the fields the scan yielded). */
export function ocrToForm(preview: OcrPreview, base: Partial<FormValues> = {}): FormValues {
  const fields = Object.fromEntries(
    Object.entries(preview.fields).filter(([k]) => FORM_KEYS.has(k)),
  ) as Partial<Record<keyof FormValues, string>>;
  return toFormValues({ ...base, ...fields });
}

/** Amber hints on fields the OCR engine was unsure about. */
export function useOcrHighlight() {
  const t = useTranslations('ocr');
  return (preview: OcrPreview | null): Partial<Record<keyof FormValues, string>> => {
    if (!preview) return {};
    return Object.fromEntries(
      preview.lowConfidence
        .filter((k: FieldKey) => FORM_KEYS.has(k))
        .map((k) => [
          k,
          t('lowConfidence', { pct: Math.round((preview.confidence[k] ?? 0) * 100) }),
        ]),
    );
  };
}

/**
 * "Upload scan to pre-fill": reads the FDR with OCR and hands back suggested values. Nothing is
 * stored until the user saves; the officer still verifies every value against the original.
 */
export function OcrPrefill({ onResult }: { onResult: (preview: OcrPreview, file: File) => void }) {
  const t = useTranslations('ocr');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(
    null,
  );

  const read = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const r = await api<{ preview: OcrPreview | null; error: string | null }>(
        '/api/ocr/preview',
        { formData: fd },
      );
      if (!r.preview || Object.keys(r.preview.fields).length === 0) {
        setMessage({ tone: 'warning', text: r.error ? t('unavailable') : t('nothingFound') });
        return;
      }
      onResult(r.preview, file);
      setMessage({
        tone: r.preview.lowConfidence.length ? 'warning' : 'success',
        text: t('filled', {
          count: Object.keys(r.preview.fields).length,
          low: r.preview.lowConfidence.length,
        }),
      });
    } catch (e) {
      setMessage({ tone: 'warning', text: errorMessage(e) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <ScanText className="h-6 w-6 shrink-0 text-brand-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-900">{t('title')}</p>
            <p className="text-sm text-slate-600">{t('hint')}</p>
          </div>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="sr-only"
            id="ocr-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            loading={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? t('reading') : t('choose')}
          </Button>
        </div>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </CardBody>
    </Card>
  );
}
