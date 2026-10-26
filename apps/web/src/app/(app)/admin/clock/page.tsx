'use client';

import { VALIDITY_STATUSES } from '@nidhisetu/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, Mail, Play, RotateCcw, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { ValidityBadge } from '@/components/badges';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Alert, PageHeader, Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/utils';

interface LifecycleSummary {
  trigger: string;
  today: string;
  heldInstruments: number;
  validityChanged: number;
  validityCounts: Record<string, number>;
  remindersCreated: number;
  escalationsCreated: number;
  durationMs: number;
  finishedAt: string;
}
interface ClockState {
  demoMode: boolean;
  today: string;
  realToday: string;
  offsetDays: number;
  lastLifecycleRun: LifecycleSummary | null;
}

export default function ClockPage() {
  const t = useTranslations('clock');
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ['admin', 'clock'],
    queryFn: () => api<ClockState>('/api/admin/clock'),
  });
  const [date, setDate] = useState('');

  const refreshAll = () => qc.invalidateQueries();
  const move = useMutation({
    mutationFn: (body: { today?: string; advanceDays?: number }) =>
      api<{ today: string }>('/api/admin/clock', { body }),
    onSuccess: async (r) => {
      toast.success(t('moved', { date: formatDate(r.today) }));
      await refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api<{ today: string }>('/api/admin/clock/reset', { method: 'POST' }),
    onSuccess: async (r) => {
      toast.success(t('moved', { date: formatDate(r.today) }));
      await refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const job = useMutation({
    mutationFn: (path: string) => api<Record<string, number>>(path, { method: 'POST' }),
    onSuccess: async (r, path) => {
      if (path.endsWith('lifecycle')) toast.success(t('ran'));
      else if (path.endsWith('digest')) toast.success(t('digestSent', { count: r.sent ?? 0 }));
      else toast.success(t('emailsSent', { count: r.sent ?? 0 }));
      await refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!data) return <Spinner />;
  const busy = move.isPending || reset.isPending || job.isPending;
  const run = data.lastLifecycleRun;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      {!data.demoMode && <Alert tone="warning">{t('disabled')}</Alert>}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-6">
          <CalendarClock className="h-10 w-10 text-brand-700" aria-hidden />
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t('simulated')}
            </p>
            <p className="text-3xl font-bold text-slate-900" aria-live="polite">
              {formatDate(data.today)}
            </p>
            <p className="text-sm text-slate-600">
              {t('real')}: {formatDate(data.realToday)} · {t('offset', { days: data.offsetDays })}
            </p>
          </div>
        </CardBody>
      </Card>

      {data.demoMode && (
        <Card>
          <CardHeader title={t('advance')} />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {[7, 30, 60, 90].map((d) => (
                <Button
                  key={d}
                  variant="secondary"
                  disabled={busy}
                  onClick={() => move.mutate({ advanceDays: d })}
                >
                  {t('plusDays', { days: d })}
                </Button>
              ))}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => move.mutate({ advanceDays: 365 })}
              >
                {t('plusYear')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => reset.mutate()}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t('reset')}
              </Button>
            </div>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (date) move.mutate({ today: date });
              }}
            >
              <Field label={t('setDate')}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" disabled={!date || busy} loading={move.isPending}>
                {t('apply')}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={t('lastRun')}
          actions={
            <>
              <Button
                size="sm"
                loading={job.isPending && job.variables?.endsWith('lifecycle')}
                disabled={busy}
                onClick={() => job.mutate('/api/admin/jobs/lifecycle')}
              >
                <Play className="h-4 w-4" aria-hidden />
                {t('runNow')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => job.mutate('/api/admin/jobs/digest')}
              >
                <Send className="h-4 w-4" aria-hidden />
                {t('runDigest')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => job.mutate('/api/admin/jobs/email-outbox')}
              >
                <Mail className="h-4 w-4" aria-hidden />
                {t('flushEmail')}
              </Button>
            </>
          }
        />
        <CardBody className="space-y-3 text-sm">
          {!run ? (
            <p className="text-slate-600">{t('never')}</p>
          ) : (
            <>
              <p className="text-slate-700">
                {formatDateTime(run.finishedAt)} ({run.trigger}) ·{' '}
                {t('summary', {
                  held: run.heldInstruments,
                  changed: run.validityChanged,
                  reminders: run.remindersCreated,
                  escalations: run.escalationsCreated,
                  ms: run.durationMs,
                })}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-slate-500">{t('counts')}:</span>
                {VALIDITY_STATUSES.map((v) => (
                  <span key={v} className="inline-flex items-center gap-1">
                    <ValidityBadge validity={v} />
                    <span className="font-semibold tabular-nums">{run.validityCounts[v] ?? 0}</span>
                  </span>
                ))}
              </div>
            </>
          )}
          <a
            href="http://localhost:8025"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-700 hover:underline"
          >
            {t('mailpit')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </CardBody>
      </Card>
    </div>
  );
}
