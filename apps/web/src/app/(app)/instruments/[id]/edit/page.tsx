'use client';

import type { InstrumentDetail } from '@nidhisetu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { InstrumentForm, toFormValues } from '@/components/instrument-form';
import { PageHeader, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api-client';

export default function EditInstrumentPage() {
  const t = useTranslations('instruments');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['instrument', id],
    queryFn: () => api<InstrumentDetail>(`/api/instruments/${id}`),
  });
  if (!data) return <Spinner />;

  const declared = (f: string) =>
    data.fields.find((x) => x.field === f)?.history.find((h) => h.trust === 'DECLARED')?.value ??
    null;
  const initial = toFormValues({
    type: data.type,
    branch: data.branch,
    bankCode: declared('bankCode'),
    ifsc: declared('ifsc'),
    fdrNumber: declared('fdrNumber'),
    amount: declared('amount'),
    issueDate: declared('issueDate'),
    maturityDate: declared('maturityDate'),
    depositorNames: declared('depositorNames'),
    lienMarked: declared('lienMarked') === 'true',
    autoRenewal: declared('autoRenewal') === 'true',
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`${t('editTitle')} · ${data.refNo}`} />
      <InstrumentForm
        initial={initial}
        submitLabel={t('saveChanges')}
        onSubmit={async (d) => {
          await api(`/api/instruments/${id}`, { method: 'PATCH', body: d });
          await qc.invalidateQueries({ queryKey: ['instrument', id] });
          toast.success(t('saved'));
          router.push(`/instruments/${id}`);
        }}
      />
    </div>
  );
}
