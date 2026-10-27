'use client';

import type { OcrPreview } from '@nidhisetu/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { EMPTY_FORM, InstrumentForm } from '@/components/instrument-form';
import { OcrPrefill, ocrToForm, useOcrHighlight } from '@/components/ocr-prefill';
import { PageHeader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';

export default function NewInstrumentPage() {
  const t = useTranslations('instruments');
  const router = useRouter();
  const qc = useQueryClient();
  const highlight = useOcrHighlight();
  const [scan, setScan] = useState<{ preview: OcrPreview; file: File; key: number } | null>(null);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('newTitle')} description={t('newSubtitle')} />
      <div className="mb-4">
        <OcrPrefill onResult={(preview, file) => setScan({ preview, file, key: Date.now() })} />
      </div>
      <InstrumentForm
        // Re-mount with the OCR values whenever a new scan is read.
        key={scan?.key ?? 0}
        initial={scan ? ocrToForm(scan.preview) : EMPTY_FORM}
        highlight={highlight(scan?.preview ?? null)}
        submitLabel={t('saveDraft')}
        onSubmit={async (d) => {
          const r = await api<{ id: string; refNo: string }>('/api/instruments', { body: d });
          if (scan) {
            // Attach the scan the form was filled from, so the OCR values are recorded as evidence.
            const fd = new FormData();
            fd.set('type', 'FDR_SCAN');
            fd.set('file', scan.file);
            await api(`/api/instruments/${r.id}/documents`, { formData: fd }).catch((e: unknown) =>
              toast.error(errorMessage(e)),
            );
          }
          await qc.invalidateQueries({ queryKey: ['instruments'] });
          toast.success(t('created', { refNo: r.refNo }));
          router.push(`/instruments/${r.id}`);
        }}
      />
    </div>
  );
}
