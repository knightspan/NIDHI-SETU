'use client';

import type { InstrumentDetail } from '@nidhisetu/shared';
import { useTranslations } from 'next-intl';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/misc';

export function InstitutionCard({ inst }: { inst: InstrumentDetail }) {
  const t = useTranslations();
  const d = inst.institutionDetail;
  return (
    <Card>
      <CardHeader title={t('instruments.institutionCard')} />
      <CardBody className="space-y-2 text-sm">
        <p className="font-semibold text-slate-900">{inst.institution.name}</p>
        <p className="text-slate-600">{d.trustName}</p>
        <p className="text-slate-600">
          {d.state} · {inst.institution.regionName} ·{' '}
          {t('instruments.established', { year: d.yearEstablished })}
        </p>
        <div>
          <p className="text-xs text-slate-500">{t('instruments.programmes')}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {d.programmes.map((p) => (
              <Badge key={p} tone="slate">
                {p.replaceAll('_', ' ').toLowerCase()}
              </Badge>
            ))}
          </div>
        </div>
        <p className={inst.jointName ? 'text-green-800' : 'font-medium text-red-700'}>
          {inst.jointName ? t('instruments.joint') : t('instruments.notJoint')}
        </p>
      </CardBody>
    </Card>
  );
}
