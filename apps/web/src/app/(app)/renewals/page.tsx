'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { InstrumentTable } from '@/components/instrument-table';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, PageHeader } from '@/components/ui/misc';
import { useMe } from '@/lib/session';
import { useUrlState } from '@/lib/use-url-state';

export default function RenewalsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const t = useTranslations('renewals');
  const { data: me } = useMe();
  const [state, set] = useUrlState(['page'] as const);
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      {me?.role === 'INSTITUTION_USER' && (
        <Alert tone="info" className="mb-4">
          {t('institutionHint')}
        </Alert>
      )}
      <Card>
        <CardBody>
          <InstrumentTable
            caption={t('title')}
            query={{ queue: 'renewal', sort: 'maturityDate', dir: 'asc', page: state.page }}
            showInstitution={me?.role !== 'INSTITUTION_USER'}
            emptyText={t('empty')}
            onPage={(p) => set({ page: String(p) }, false)}
          />
        </CardBody>
      </Card>
    </>
  );
}
