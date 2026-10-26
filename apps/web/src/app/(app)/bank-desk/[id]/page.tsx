'use client';

import type { BankRequestView } from '@nidhisetu/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Alert, Badge, PageHeader, Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';
import { formatDate, formatInr } from '@/lib/utils';
import { BANK_STATUS_TONE, BankRequestCard } from '@/components/instrument/bank-panel';

type YesNo = 'yes' | 'no' | '';

export default function BankRequestPage() {
  const t = useTranslations();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: r, error } = useQuery({
    queryKey: ['bank-request', id],
    queryFn: () => api<BankRequestView>(`/api/bank-requests/${id}`),
  });

  const [exists, setExists] = useState<YesNo>('yes');
  const [lien, setLien] = useState<YesNo>('');
  const [autoRenewal, setAutoRenewal] = useState<YesNo>('');
  const [maturity, setMaturity] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!r) return <Spinner />;
  const s = r.snapshot;
  const open = r.status === 'PENDING' || r.status === 'FAILED';
  const maturityValue = maturity ?? s.maturityDate ?? '';
  const amountValue = amount ?? (s.amount ? String(Number(s.amount)) : '');
  const allAgree =
    exists === 'yes' &&
    lien === 'yes' &&
    maturityValue === s.maturityDate &&
    (autoRenewal === 'yes') === s.autoRenewal &&
    autoRenewal !== '' &&
    Number(amountValue) === Number(s.amount);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (exists === 'yes' && (lien === '' || autoRenewal === '' || !maturityValue)) {
      setFormError(t('common.required'));
      return;
    }
    setBusy(true);
    try {
      let letterDocumentId: string | undefined;
      const file = fileRef.current?.files?.[0];
      if (file) {
        const fd = new FormData();
        fd.set('file', file);
        letterDocumentId = (
          await api<{ documentId: string }>(`/api/bank-requests/${id}/letter`, { formData: fd })
        ).documentId;
      }
      await api(`/api/bank-requests/${id}/respond`, {
        body:
          exists === 'yes'
            ? {
                exists: true,
                lienMarked: lien === 'yes',
                maturityDate: maturityValue,
                autoRenewal: autoRenewal === 'yes',
                amount: amountValue ? Number(amountValue) : null,
                remarks: remarks || undefined,
                reference: reference || undefined,
                letterDocumentId,
              }
            : {
                exists: false,
                lienMarked: null,
                maturityDate: null,
                autoRenewal: null,
                remarks: remarks || undefined,
                letterDocumentId,
              },
      });
      toast.success(t('bank.sent'));
      await qc.invalidateQueries({ queryKey: ['bank-requests'] });
      router.push('/bank-desk');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const yesNo = (name: string, value: YesNo, set: (v: YesNo) => void, legend: string) => (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-slate-800">{legend}</legend>
      <div className="flex gap-2">
        {(['yes', 'no'] as const).map((v) => (
          <label
            key={v}
            className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-medium ${
              value === v
                ? v === 'yes'
                  ? 'border-green-700 bg-green-50 text-green-900'
                  : 'border-red-700 bg-red-50 text-red-900'
                : 'border-slate-300 bg-white'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={v}
              checked={value === v}
              onChange={() => set(v)}
              className="sr-only"
            />
            {v === 'yes' ? t('common.yes') : t('common.no')}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/bank-desk"
        className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t('bank.deskTitle')}
      </Link>
      <PageHeader
        title={t('bank.requestFor', { refNo: s.refNo })}
        description={s.institutionName}
        actions={<Badge tone={BANK_STATUS_TONE[r.status]}>{t(`bank.statuses.${r.status}`)}</Badge>}
      />

      <Card>
        <CardHeader title={t('bank.aicteHolds')} />
        <CardBody>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row k={t('fields.fdrNumber')} v={s.fdrNumber} mono />
            <Row k={t('fields.ifsc')} v={`${s.ifsc ?? '—'} · ${s.branch ?? ''}`} />
            <Row k={t('fields.amount')} v={formatInr(s.amount)} />
            <Row k={t('fields.issueDate')} v={formatDate(s.issueDate)} />
            <Row k={t('fields.maturityDate')} v={formatDate(s.maturityDate)} />
            <Row k={t('fields.depositorNames')} v={s.depositorNames} />
            <Row k={t('fields.lienMarked')} v={s.lienMarked ? t('common.yes') : t('common.no')} />
            <Row k={t('fields.autoRenewal')} v={s.autoRenewal ? t('common.yes') : t('common.no')} />
          </dl>
        </CardBody>
      </Card>

      {open ? (
        <Card>
          <CardHeader title={t('bank.yourAnswer')} description={t('bank.answerHelp')} />
          <CardBody>
            <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
              {formError && <Alert tone="error">{formError}</Alert>}
              {yesNo('exists', exists, setExists, t('bank.qExists'))}
              {exists === 'yes' && (
                <>
                  {yesNo('lien', lien, setLien, t('bank.qLien'))}
                  {yesNo('autoRenewal', autoRenewal, setAutoRenewal, t('bank.qAutoRenewal'))}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('bank.qMaturity')} required>
                      {(p) => (
                        <Input
                          {...p}
                          type="date"
                          value={maturityValue}
                          onChange={(e) => setMaturity(e.target.value)}
                        />
                      )}
                    </Field>
                    <Field label={t('bank.qAmount')}>
                      {(p) => (
                        <Input
                          {...p}
                          inputMode="decimal"
                          value={amountValue}
                          onChange={(e) => setAmount(e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                  <Field label={t('bank.reference')}>
                    {(p) => (
                      <Input
                        {...p}
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                      />
                    )}
                  </Field>
                </>
              )}
              <Field label={t('bank.remarks')}>
                {(p) => (
                  <Textarea
                    {...p}
                    rows={2}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('bank.letter')}>
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
              <Button
                type="submit"
                size="lg"
                className="w-full sm:w-auto"
                variant={allAgree ? 'success' : 'primary'}
                loading={busy}
              >
                {allAgree ? (
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
                {allAgree ? t('bank.submitConfirm') : t('bank.submitDeny')}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : (
        <BankRequestCard r={r} instrumentId={r.instrumentId} canRetry={false} />
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1 sm:block sm:border-0">
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className={`font-medium text-slate-900 ${mono ? 'font-mono' : ''}`}>{v ?? '—'}</dd>
    </div>
  );
}
