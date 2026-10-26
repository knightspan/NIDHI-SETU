'use client';

import { LIFECYCLE_STATUSES, VALIDITY_STATUSES } from '@nidhisetu/shared';
import { FilePlus2, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { InstrumentTable } from '@/components/instrument-table';
import { SavedFilters } from '@/components/saved-filters';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { useBanks, useRegions } from '@/lib/master-data';
import { can, useMe } from '@/lib/session';
import { useUrlState } from '@/lib/use-url-state';

const KEYS = [
  'q',
  'status',
  'validity',
  'regionId',
  'bankCode',
  'mismatch',
  'legacy',
  'sort',
  'dir',
  'page',
] as const;

export default function InstrumentsPage() {
  return (
    <Suspense>
      <InstrumentsInner />
    </Suspense>
  );
}

function InstrumentsInner() {
  const t = useTranslations();
  const { data: me } = useMe();
  const [state, set] = useUrlState(KEYS);
  const { banks } = useBanks();
  const { regions } = useRegions();
  const [q, setQ] = useState(state.q ?? '');
  const isInstitution = me?.role === 'INSTITUTION_USER';

  // Debounced free-text search.
  useEffect(() => {
    const h = setTimeout(() => {
      if ((state.q ?? '') !== q) set({ q });
    }, 300);
    return () => clearTimeout(h);
  }, [q, state.q, set]);

  return (
    <>
      <PageHeader
        title={isInstitution ? t('instruments.mine') : t('instruments.title')}
        description={t('instruments.subtitle')}
        actions={
          can(me, 'instrument:write_own') && (
            <Link href="/instruments/new" className={buttonVariants()}>
              <FilePlus2 className="h-4 w-4" aria-hidden />
              {t('instruments.new')}
            </Link>
          )
        }
      />
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="search">
            <div className="relative sm:col-span-2">
              <Search
                className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400"
                aria-hidden
              />
              <Input
                aria-label={t('common.search')}
                placeholder={t('instruments.searchPlaceholder')}
                className="pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select
              aria-label={t('instruments.colStatus')}
              value={state.status ?? ''}
              onChange={(e) => set({ status: e.target.value })}
            >
              <option value="">{t('instruments.anyStatus')}</option>
              {LIFECYCLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`lifecycle.${s}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('instruments.colValidity')}
              value={state.validity ?? ''}
              onChange={(e) => set({ validity: e.target.value })}
            >
              <option value="">{t('instruments.anyValidity')}</option>
              {VALIDITY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`validity.${s}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('instruments.colBank')}
              value={state.bankCode ?? ''}
              onChange={(e) => set({ bankCode: e.target.value })}
            >
              <option value="">{t('instruments.anyBank')}</option>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </Select>
            {!isInstitution && me?.role !== 'RO_OFFICER' && (
              <Select
                aria-label={t('fields.region')}
                value={state.regionId ?? ''}
                onChange={(e) => set({ regionId: e.target.value })}
              >
                <option value="">{t('instruments.anyRegion')}</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <SavedFilters />
          <InstrumentTable
            caption={t('instruments.title')}
            query={{ ...state, pageSize: 25 }}
            showInstitution={!isInstitution}
            emptyText={isInstitution ? t('instruments.emptyInstitution') : undefined}
            onPage={(page) => set({ page: String(page) }, false)}
          />
        </CardBody>
      </Card>
    </>
  );
}
