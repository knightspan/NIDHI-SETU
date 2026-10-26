'use client';

import type { InstrumentDetail } from '@nidhisetu/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { StatusBadge } from '@/components/badges';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { cn, formatDate, formatDateTime, formatInr } from '@/lib/utils';

export function TimelinePanel({ inst }: { inst: InstrumentDetail }) {
  const t = useTranslations();
  return (
    <Card>
      <CardHeader title={t('instruments.timeline')} />
      <CardBody>
        <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
          {inst.transitions.map((tr, i) => (
            <li key={i} className="relative">
              <span
                className={cn(
                  'absolute top-1 -left-[27px] h-3 w-3 rounded-full ring-4 ring-white',
                  i === inst.transitions.length - 1 ? 'bg-brand-700' : 'bg-slate-400',
                )}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={tr.to} />
                <time className="text-xs text-slate-500" dateTime={tr.at}>
                  {formatDateTime(tr.at)}
                </time>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                {tr.actorName ?? t('roles.SYSTEM')} · {t(`roles.${tr.actorRole}`)}
              </p>
              {tr.note && (
                <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-sm text-slate-800">
                  {tr.note}
                </p>
              )}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

/** Renewal chain, oldest first (Section 7 · cap 5). */
export function ChainPanel({ inst }: { inst: InstrumentDetail }) {
  const t = useTranslations();
  if (inst.chain.length === 0) return null;
  return (
    <Card>
      <CardHeader title={t('instruments.chain')} />
      <CardBody>
        <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          {inst.chain.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 sm:flex-1">
              <Link
                href={`/instruments/${c.id}`}
                aria-current={c.id === inst.id ? 'page' : undefined}
                className={cn(
                  'block w-full rounded-md border p-3 text-sm hover:border-brand-600',
                  c.id === inst.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white',
                )}
              >
                <p className="font-semibold text-slate-900">{c.refNo}</p>
                <p className="text-xs text-slate-600">
                  {formatInr(c.amount)} · {formatDate(c.maturityDate)}
                </p>
                <div className="mt-1">
                  <StatusBadge status={c.status} />
                </div>
                {c.id === inst.id && (
                  <p className="mt-1 text-xs font-medium text-brand-700">
                    {t('instruments.chainCurrent')}
                  </p>
                )}
              </Link>
              {i < inst.chain.length - 1 && (
                <span className="hidden text-slate-400 sm:inline" aria-hidden>
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
