'use client';

import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { InstrumentTable } from '@/components/instrument-table';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/misc';
import { useUrlState } from '@/lib/use-url-state';

export default function ScrutinyQueuePage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const t = useTranslations('scrutiny');
  const [state, set] = useUrlState(['page'] as const);
  return (
    <>
      <PageHeader title={t('queueTitle')} description={t('queueSubtitle')} />
      <Card>
        <CardBody>
          <InstrumentTable
            caption={t('queueTitle')}
            query={{ queue: 'scrutiny', sort: 'updatedAt', dir: 'asc', page: state.page }}
            onPage={(p) => set({ page: String(p) }, false)}
          />
        </CardBody>
      </Card>
    </>
  );
}
