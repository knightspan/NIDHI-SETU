'use client';

import type { DashboardData } from '@nidhisetu/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChartCard, HBarChart, StatusStack } from '@/components/charts';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';
import { useMe } from '@/lib/session';
import { cn, formatDate, formatInr } from '@/lib/utils';

const compactInr = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : formatInr(v);

export default function DashboardPage() {
  const t = useTranslations();
  const { data: me } = useMe();
  const { data, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/api/dashboard'),
    refetchInterval: 60_000,
  });

  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  const k = data?.kpis;
  const showFinancials = data && data.scope !== 'NONE';

  const tiles: {
    key: keyof NonNullable<typeof k>;
    tone?: 'warn' | 'bad' | 'good';
    href?: string;
  }[] = [
    { key: 'active', tone: 'good', href: '/instruments?status=ACTIVE' },
    { key: 'pendingVerification', href: '/scrutiny' },
    { key: 'expiring30', tone: 'warn', href: '/renewals' },
    { key: 'expiring60', tone: 'warn', href: '/renewals' },
    { key: 'expiring90', tone: 'warn', href: '/renewals' },
    { key: 'matured', href: '/instruments?validity=MATURED' },
    { key: 'overdue', tone: 'bad', href: '/instruments?validity=OVERDUE_RENEWAL' },
    { key: 'openDiscrepancies', tone: 'bad', href: '/discrepancies' },
    { key: 'renewed', href: '/instruments?status=RENEWED' },
    { key: 'released', href: '/instruments?status=RELEASED' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={
          me && data
            ? `${t('dashboard.welcome', { name: me.name })} · ${t('dashboard.asOf', { date: formatDate(data.today) })}`
            : undefined
        }
      />

      {!data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          {k!.fraudSignals > 0 && (
            <Link href="/discrepancies?ruleCode=DUPLICATE_FDR" className="block">
              <Alert tone="error" title={`${k!.fraudSignals} · ${t('dashboard.kpi.fraudSignals')}`}>
                <span className="inline-flex items-center gap-1">
                  <AlertOctagon className="h-4 w-4" aria-hidden />
                  {t('discrepancies.rules.DUPLICATE_FDR')}{' '}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </Alert>
            </Link>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {showFinancials && (
              <Card tone="screen" className="lg:col-span-1">
                <CardBody>
                  <p className="dp-engrave dp-engrave-light">{t('dashboard.kpi.heldAmount')}</p>
                  <p className="dp-readout">{compactInr(Number(k!.heldAmount))}</p>
                  <p className="dp-screen-sub">
                    {formatInr(k!.heldAmount)} ·{' '}
                    {t('dashboard.kpi.heldCount', { count: k!.heldCount })}
                  </p>
                </CardBody>
              </Card>
            )}
            <Card className={showFinancials ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CardHeader title={t('dashboard.workQueue')} />
              <CardBody>
                {data.queue.every((q) => q.count === 0) ? (
                  <p className="text-sm text-slate-600">{t('dashboard.queueEmpty')}</p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {data.queue.map((q) => (
                      <li key={q.key}>
                        <Link
                          href={q.href}
                          className={cn(
                            'dp-queue dp-press',
                            q.urgent && q.count > 0 && 'dp-queue-hot',
                          )}
                        >
                          <span>{t(`dashboard.queue.${q.key}`)}</span>
                          <span
                            className={cn(
                              'dp-queue-count',
                              q.urgent && q.count > 0 ? 'text-red-700' : 'text-ink',
                            )}
                          >
                            {q.count}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          {showFinancials && (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {tiles.map((tile) => (
                  <li key={tile.key}>
                    <Link href={tile.href ?? '#'} className="block h-full rounded-[4px]">
                      <Card className="relative h-full p-4">
                        {(tile.tone === 'bad' || tile.tone === 'warn') && !!k![tile.key] && (
                          <span
                            className={cn(
                              'dp-lamp absolute top-3 right-3',
                              tile.tone === 'bad' ? 'dp-lamp-bad' : 'dp-lamp-on',
                            )}
                            aria-hidden
                          />
                        )}
                        <p className="dp-engrave pr-4">{t(`dashboard.kpi.${tile.key}`)}</p>
                        <p
                          className={cn(
                            'mt-1 text-2xl font-bold tabular-nums',
                            tile.tone === 'bad' && k![tile.key]
                              ? 'text-red-700'
                              : tile.tone === 'warn' && k![tile.key]
                                ? 'text-amber-800'
                                : 'text-slate-900',
                          )}
                        >
                          {k![tile.key]}
                        </p>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard
                  title={t('dashboard.byValidity')}
                  table={{
                    headers: [t('fields.validity'), t('dashboard.count')],
                    rows: data.byValidity.map((v) => [t(`validity.${v.validity}`), v.count]),
                  }}
                >
                  <StatusStack
                    parts={data.byValidity.map((v) => ({
                      key: v.validity,
                      label: t(`validity.${v.validity}`),
                      count: v.count,
                      status: (
                        {
                          VALID: 'good',
                          EXPIRING_SOON: 'warning',
                          MATURED: 'serious',
                          OVERDUE_RENEWAL: 'critical',
                        } as const
                      )[v.validity],
                    }))}
                  />
                </ChartCard>
                <ChartCard
                  title={t('dashboard.byStatus')}
                  table={{
                    headers: [t('fields.status'), t('dashboard.count')],
                    rows: data.byStatus.map((s) => [t(`lifecycle.${s.status}`), s.count]),
                  }}
                >
                  {data.byStatus.length === 0 ? (
                    <p className="text-sm text-slate-600">{t('dashboard.noData')}</p>
                  ) : (
                    <HBarChart
                      data={[...data.byStatus]
                        .sort((a, b) => b.count - a.count)
                        .map((s) => ({ label: t(`lifecycle.${s.status}`), value: s.count }))}
                      format={(v) => String(v)}
                    />
                  )}
                </ChartCard>
                {data.byRegion.length > 0 && (
                  <ChartCard
                    title={t('dashboard.byRegion')}
                    table={{
                      headers: [t('fields.region'), t('dashboard.amount'), t('dashboard.count')],
                      rows: data.byRegion.map((r) => [r.name, formatInr(r.amount), r.count]),
                    }}
                  >
                    <HBarChart
                      data={data.byRegion.map((r) => ({
                        label: r.name,
                        value: Number(r.amount),
                        sub: t('dashboard.kpi.heldCount', { count: r.count }),
                      }))}
                      format={compactInr}
                    />
                  </ChartCard>
                )}
                {data.byBank.length > 0 && (
                  <ChartCard
                    title={t('dashboard.byBank')}
                    table={{
                      headers: [t('fields.bankCode'), t('dashboard.amount'), t('dashboard.count')],
                      rows: data.byBank.map((b) => [b.name, formatInr(b.amount), b.count]),
                    }}
                  >
                    <HBarChart
                      data={data.byBank.slice(0, 8).map((b) => ({
                        label: b.name,
                        value: Number(b.amount),
                        sub: t('dashboard.kpi.heldCount', { count: b.count }),
                      }))}
                      format={compactInr}
                    />
                  </ChartCard>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
