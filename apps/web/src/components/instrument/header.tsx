'use client';

import type { InstrumentDetail } from '@nidhisetu/shared';
import { AlertTriangle, Archive, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { StatusBadge, TrustScore, ValidityBadge } from '@/components/badges';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/misc';
import { formatDate, formatInr } from '@/lib/utils';

export function InstrumentHeader({ inst }: { inst: InstrumentDetail }) {
  const t = useTranslations();
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="dp-engrave">{t(`instrumentTypes.${inst.type}`)}</p>
            <h1 className="dp-ref mt-1">{inst.refNo}</h1>
            <p className="mt-0.5 text-sm text-slate-700">
              {inst.institution.name} ·{' '}
              <span className="text-slate-500">{inst.institution.aicteId}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={inst.status} />
              <ValidityBadge validity={inst.validityStatus} />
              {inst.legacy && (
                <Badge tone="slate">
                  <Archive className="h-3 w-3" aria-hidden />
                  {t('instruments.legacy')}
                </Badge>
              )}
              {inst.openDiscrepancies > 0 && (
                <Badge tone="red">
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  {t('instruments.openDiscrepancies', { count: inst.openDiscrepancies })}
                </Badge>
              )}
              {inst.replacedBy && (
                <Link href={`/instruments/${inst.replacedBy.id}`}>
                  <Badge tone="purple">
                    <Link2 className="h-3 w-3" aria-hidden />
                    {t('instruments.replacedBy', { refNo: inst.replacedBy.refNo })}
                  </Badge>
                </Link>
              )}
            </div>
          </div>
          <div className="w-full max-w-56 space-y-1">
            <p className="dp-engrave">{t('trust.score')}</p>
            <TrustScore score={inst.trustScore} />
          </div>
        </div>
        <dl className="dp-facts text-sm">
          <Fact label={t('fields.amount')} value={formatInr(inst.amount)} />
          <Fact label={t('fields.bankCode')} value={inst.bankName ?? inst.bankCode ?? '—'} />
          <Fact label={t('fields.issueDate')} value={formatDate(inst.issueDate)} />
          <Fact label={t('fields.maturityDate')} value={formatDate(inst.maturityDate)} />
        </dl>
      </CardBody>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="dp-engrave">{label}</dt>
      <dd className="mt-1 font-semibold tracking-tight text-ink">{value}</dd>
    </div>
  );
}
