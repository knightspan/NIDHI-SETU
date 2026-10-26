'use client';

import type { BankRequestView, InstrumentDetail } from '@nidhisetu/shared';
import { Building2, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge, EmptyState } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api-client';
import { formatDate, formatDateTime, formatInr } from '@/lib/utils';
import { documentUrl } from './documents-panel';
import { useInstrumentAction } from './use-instrument';

export const BANK_STATUS_TONE = {
  PENDING: 'amber',
  CONFIRMED: 'green',
  DENIED: 'red',
  FAILED: 'red',
} as const;

export function BankPanel({ inst, canRetry }: { inst: InstrumentDetail; canRetry: boolean }) {
  const t = useTranslations();
  if (inst.bankRequests.length === 0 && !inst.allowedActions.includes('send_to_bank')) return null;
  return (
    <Card>
      <CardHeader title={t('bank.panelTitle')} />
      <CardBody className="space-y-3">
        {inst.bankRequests.length === 0 ? (
          <EmptyState title={t('bank.none')} />
        ) : (
          inst.bankRequests.map((r) => (
            <BankRequestCard key={r.id} r={r} instrumentId={inst.id} canRetry={canRetry} />
          ))
        )}
      </CardBody>
    </Card>
  );
}

export function BankRequestCard({
  r,
  instrumentId,
  canRetry,
}: {
  r: BankRequestView;
  instrumentId: string;
  canRetry: boolean;
}) {
  const t = useTranslations();
  const act = useInstrumentAction(instrumentId);
  const yn = (v: boolean | null | undefined) =>
    v === null || v === undefined ? '—' : v ? t('common.yes') : t('common.no');
  return (
    <div className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Building2 className="h-4 w-4 text-slate-500" aria-hidden />
        <span className="font-semibold text-slate-900">{r.bankName}</span>
        <Badge tone={BANK_STATUS_TONE[r.status]}>{t(`bank.statuses.${r.status}`)}</Badge>
        <span className="text-xs text-slate-500">{t(`bank.channels.${r.channel}`)}</span>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {t('bank.requestedBy', { who: r.requestedBy ?? '—', when: formatDateTime(r.createdAt) })}
        {r.respondedAt &&
          ` · ${t('bank.respondedBy', { who: r.respondedBy ?? '—', when: formatDateTime(r.respondedAt) })}`}
      </p>
      {r.status === 'PENDING' && (
        <p className="mt-1 text-xs text-slate-600">
          {t('bank.due', { date: formatDate(r.slaDueAt) })}
        </p>
      )}
      {r.failureReason && (
        <p className="mt-1 text-xs font-medium text-red-700">
          {r.failureReason} · {t('bank.attempts', { count: r.attempts })}
        </p>
      )}
      {r.response && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
          <Item k={t('bank.answerExists')} v={yn(r.response.exists)} bad={!r.response.exists} />
          <Item
            k={t('bank.answerLien')}
            v={yn(r.response.lienMarked)}
            bad={r.response.lienMarked === false}
          />
          <Item k={t('bank.answerMaturity')} v={formatDate(r.response.maturityDate)} />
          <Item k={t('bank.answerAutoRenewal')} v={yn(r.response.autoRenewal)} />
          <Item k={t('bank.answerAmount')} v={formatInr(r.response.amount ?? null)} />
        </dl>
      )}
      {r.response?.remarks && (
        <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-slate-800">“{r.response.remarks}”</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {r.letterDocumentId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void documentUrl(r.letterDocumentId!, true)
                .then((url) => window.open(url, '_blank', 'noopener'))
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          >
            {t('bank.viewLetter')}
          </Button>
        )}
        {canRetry && r.status === 'FAILED' && (
          <Button
            size="sm"
            variant="secondary"
            loading={act.isPending}
            onClick={() =>
              act.mutate({ path: `/api/bank-requests/${r.id}/retry`, success: t('bank.retried') })
            }
          >
            <RotateCw className="h-4 w-4" aria-hidden />
            {t('bank.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Item({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className={bad ? 'font-semibold text-red-700' : 'font-medium text-slate-900'}>{v}</dd>
    </div>
  );
}
