'use client';

import type { MetricView } from '@nidhisetu/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { HBarChart } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Alert, Dialog, PageHeader, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';
import { can, useMe } from '@/lib/session';

export default function MetricsPage() {
  const t = useTranslations('metrics');
  const { data: me } = useMe();
  const { data, error } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => api<MetricView[]>('/api/metrics'),
  });
  const [editing, setEditing] = useState<MetricView | null>(null);
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  const fmt = (m: MetricView, v: number | null) =>
    v === null ? '—' : `${v}${m.unit === 'percent' ? '%' : ` ${t('units.days')}`}`;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      {!data ? (
        <Skeleton className="h-60" />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((m) => {
            const diff = m.value !== null && m.baseline !== null ? m.value - m.baseline : null;
            const better =
              diff !== null && diff !== 0 ? (m.betterWhen === 'lower' ? diff < 0 : diff > 0) : null;
            const Icon =
              diff === null || diff === 0 ? Minus : diff < 0 ? ArrowDownRight : ArrowUpRight;
            return (
              <li key={m.key}>
                <Card className="h-full">
                  <CardBody className="space-y-2">
                    <h2 className="text-sm font-semibold text-slate-800">{t(`names.${m.key}`)}</h2>
                    <p className="text-4xl font-bold tracking-tight text-brand-900 tabular-nums">
                      {fmt(m, m.value)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {m.value === null ? t('noValue') : t('sample', { count: m.sampleSize })} ·{' '}
                      {m.betterWhen === 'lower' ? t('lowerBetter') : t('higherBetter')}
                    </p>
                    <div className="flex items-center gap-2 border-t border-slate-100 pt-2 text-sm">
                      <span className="text-slate-600">{t('baseline')}:</span>
                      <span className="font-semibold tabular-nums">
                        {m.baseline === null ? t('noBaseline') : fmt(m, m.baseline)}
                      </span>
                      {better !== null && (
                        <span
                          className={`ml-auto inline-flex items-center gap-1 text-xs font-semibold ${better ? 'text-green-800' : 'text-red-700'}`}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                          {better ? t('better') : t('worse')}
                        </span>
                      )}
                    </div>
                    {m.baselineNote && <p className="text-xs text-slate-500">{m.baselineNote}</p>}
                    {m.buckets && m.sampleSize > 0 && (
                      <div>
                        <p className="text-xs font-medium text-slate-600">{t('ageing')}</p>
                        <HBarChart
                          data={m.buckets.map((b) => ({ label: b.label, value: b.count }))}
                          format={(v) => String(v)}
                        />
                      </div>
                    )}
                    {can(me, 'metrics:baseline') && (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>
                        {t('setBaseline')}
                      </Button>
                    )}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <BaselineDialog m={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BaselineDialog({ m, onClose }: { m: MetricView; onClose: () => void }) {
  const t = useTranslations('metrics');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [value, setValue] = useState(m.baseline === null ? '' : String(m.baseline));
  const [note, setNote] = useState(m.baselineNote ?? '');
  const save = useMutation({
    mutationFn: () =>
      api(`/api/metrics/baselines/${m.key}`, {
        method: 'PUT',
        body: { value: Number(value), note: note || undefined },
      }),
    onSuccess: async () => {
      toast.success(t('baselineSaved'));
      await qc.invalidateQueries({ queryKey: ['metrics'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t('setBaseline')}: ${t(`names.${m.key}`)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            disabled={value === '' || Number.isNaN(Number(value))}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label={`${t('baseline')} (${m.unit === 'percent' ? '%' : t('units.days')})`}
          required
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              step="0.1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('baselineNote')}>
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
