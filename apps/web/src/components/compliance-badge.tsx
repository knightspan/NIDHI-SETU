'use client';

import type { InstitutionSummaryView } from '@nidhisetu/shared';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/misc';

export function ComplianceBadge({
  i,
}: {
  i: Pick<InstitutionSummaryView, 'exempt' | 'compliant'>;
}) {
  const t = useTranslations('institutions');
  if (i.exempt) return <Badge tone="slate">{t('exempt')}</Badge>;
  return i.compliant ? (
    <Badge tone="green">{t('compliant')}</Badge>
  ) : (
    <Badge tone="red">{t('shortfall')}</Badge>
  );
}
