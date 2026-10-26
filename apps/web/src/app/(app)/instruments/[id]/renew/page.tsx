'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { InstrumentForm, toFormValues } from '@/components/instrument-form';
import { useInstrument } from '@/components/instrument/use-instrument';
import { Alert, PageHeader, Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';

/** Same tenure as the old FDR, starting when it matures. */
function nextTerm(
  issue: string | null,
  maturity: string | null,
): { issueDate: string; maturityDate: string } {
  if (!issue || !maturity) return { issueDate: '', maturityDate: '' };
  const i = new Date(`${issue}T00:00:00Z`);
  const m = new Date(`${maturity}T00:00:00Z`);
  const next = new Date(m.getTime() + (m.getTime() - i.getTime()));
  return { issueDate: maturity, maturityDate: next.toISOString().slice(0, 10) };
}

export default function RenewInstrumentPage() {
  const t = useTranslations();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: old, error } = useInstrument(id);
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!old) return <Spinner />;

  const term = nextTerm(old.issueDate, old.maturityDate);
  const initial = toFormValues({
    type: old.type,
    bankCode: old.bankCode,
    branch: old.branch,
    ifsc: old.ifsc,
    fdrNumber: '',
    amount: old.amount ? String(Number(old.amount)) : '',
    issueDate: term.issueDate,
    maturityDate: term.maturityDate,
    depositorNames: old.depositorNames,
    lienMarked: true,
    autoRenewal: old.autoRenewal,
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('instruments.renewTitle')}
        description={t('instruments.renewSubtitle', { refNo: old.refNo })}
      />
      <InstrumentForm
        initial={initial}
        submitLabel={t('instruments.saveDraft')}
        onSubmit={async (d) => {
          const r = await api<{ id: string; refNo: string }>(`/api/instruments/${id}/renewal`, {
            body: d,
          });
          await qc.invalidateQueries({ queryKey: ['instruments'] });
          await qc.invalidateQueries({ queryKey: ['instrument', id] });
          toast.success(t('instruments.created', { refNo: r.refNo }));
          router.push(`/instruments/${r.id}`);
        }}
      />
    </div>
  );
}
