'use client';

import type { LifecycleStatus, TrustLevel, ValidityStatus } from '@nidhisetu/shared';
import { AlertOctagon, BadgeCheck, Building2, FileScan, Keyboard, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

type Tone = Parameters<typeof Badge>[0]['tone'];

const STATUS_TONE: Record<LifecycleStatus, Tone> = {
  DRAFT: 'slate',
  SUBMITTED: 'blue',
  UNDER_SCRUTINY: 'blue',
  DISCREPANCY_RAISED: 'red',
  OFFICER_VERIFIED: 'amber',
  BANK_CONFIRMATION_PENDING: 'amber',
  BANK_CONFIRMED: 'green',
  ACTIVE: 'green',
  RENEWAL_PENDING: 'purple',
  RENEWED: 'slate',
  RELEASE_REQUESTED: 'purple',
  RELEASE_RECOMMENDED: 'purple',
  RELEASE_APPROVED: 'purple',
  RELEASED: 'slate',
  RELEASE_REJECTED: 'red',
  REJECTED: 'red',
};

export function StatusBadge({ status }: { status: LifecycleStatus }) {
  const t = useTranslations('lifecycle');
  return <Badge tone={STATUS_TONE[status]}>{t(status)}</Badge>;
}

const VALIDITY_TONE: Record<ValidityStatus, Tone> = {
  VALID: 'green',
  EXPIRING_SOON: 'amber',
  MATURED: 'purple',
  OVERDUE_RENEWAL: 'red',
};

export function ValidityBadge({ validity }: { validity: ValidityStatus | null }) {
  const t = useTranslations('validity');
  if (!validity) return <span className="text-slate-400">—</span>;
  return <Badge tone={VALIDITY_TONE[validity]}>{t(validity)}</Badge>;
}

/** Trust-level badges (Section 3.1): grey / blue / amber / green, red for mismatch. */
const TRUST_STYLE: Record<
  TrustLevel | 'MISMATCH' | 'NONE',
  { cls: string; Icon: typeof Keyboard }
> = {
  DECLARED: { cls: 'bg-slate-100 text-trust-declared ring-slate-300', Icon: Keyboard },
  OCR_EXTRACTED: { cls: 'bg-blue-50 text-trust-ocr ring-blue-300', Icon: FileScan },
  OFFICER_VERIFIED: { cls: 'bg-amber-50 text-trust-officer ring-amber-300', Icon: ShieldCheck },
  BANK_CONFIRMED: { cls: 'bg-green-50 text-trust-bank ring-green-300', Icon: Building2 },
  MISMATCH: { cls: 'bg-red-50 text-trust-mismatch ring-red-300', Icon: AlertOctagon },
  NONE: { cls: 'bg-white text-slate-500 ring-slate-200', Icon: BadgeCheck },
};

export function TrustBadge({
  level,
  mismatch,
  className,
}: {
  level: TrustLevel | null;
  mismatch?: boolean;
  className?: string;
}) {
  const t = useTranslations('trust');
  const key = mismatch ? 'MISMATCH' : (level ?? 'NONE');
  const { cls, Icon } = TRUST_STYLE[key];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        cls,
        className,
      )}
      title={key === 'NONE' ? undefined : t(`${key}_help`)}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {t(key)}
    </span>
  );
}

export function TrustLegend() {
  const t = useTranslations('trust');
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="font-medium">{t('legendTitle')}:</span>
      {(['DECLARED', 'OCR_EXTRACTED', 'OFFICER_VERIFIED', 'BANK_CONFIRMED'] as const).map((l) => (
        <TrustBadge key={l} level={l} />
      ))}
      <TrustBadge level={null} mismatch />
    </div>
  );
}

export function TrustScore({ score, compact }: { score: number; compact?: boolean }) {
  const t = useTranslations('trust');
  const color =
    score >= 90
      ? 'bg-green-600'
      : score >= 60
        ? 'bg-amber-500'
        : score >= 30
          ? 'bg-blue-600'
          : 'bg-slate-400';
  return (
    <div className={cn('flex items-center gap-2', compact ? 'min-w-24' : 'min-w-40')}>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label={t('score')}
      >
        <div className={cn('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-semibold tabular-nums text-slate-800">
        {score}
      </span>
    </div>
  );
}
