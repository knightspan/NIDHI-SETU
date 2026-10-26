'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { InstrumentForm } from '@/components/instrument-form';
import { PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api-client';

export default function NewInstrumentPage() {
  const t = useTranslations('instruments');
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('newTitle')} description={t('newSubtitle')} />
      <InstrumentForm
        submitLabel={t('saveDraft')}
        onSubmit={async (d) => {
          const r = await api<{ id: string; refNo: string }>('/api/instruments', { body: d });
          await qc.invalidateQueries({ queryKey: ['instruments'] });
          toast.success(t('created', { refNo: r.refNo }));
          router.push(`/instruments/${r.id}`);
        }}
      />
    </div>
  );
}
