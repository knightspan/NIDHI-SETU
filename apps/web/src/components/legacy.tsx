'use client';

import type { LegacyBatchView, ReconciliationRow } from '@nidhisetu/shared';
import { useTranslations } from 'next-intl';
import { Badge, Spinner } from '@/components/ui/misc';

export const KIND_TONE: Record<ReconciliationRow['kind'], 'red' | 'amber' | 'purple' | 'slate'> = {
  MISSING: 'red',
  EXPIRED: 'red',
  MISMATCHED: 'amber',
  DUPLICATED: 'purple',
  UNREVIEWED: 'slate',
};

export function BatchProgress({ counts }: { counts: LegacyBatchView['counts'] }) {
  const t = useTranslations('legacy');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {counts.ocrRunning > 0 && (
        <Spinner label={t('ocrRunning', { count: counts.ocrRunning })} className="text-xs" />
      )}
      {counts.pending > 0 && <Badge tone="amber">{t('pending', { count: counts.pending })}</Badge>}
      {counts.confirmed > 0 && (
        <Badge tone="green">{t('confirmed', { count: counts.confirmed })}</Badge>
      )}
      {counts.rejected > 0 && (
        <Badge tone="slate">{t('rejected', { count: counts.rejected })}</Badge>
      )}
    </div>
  );
}
