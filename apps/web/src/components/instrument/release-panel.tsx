'use client';

import type { InstrumentDetail, ReleaseChecklistItem, ReleaseView } from '@nidhisetu/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, HandCoins, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Alert, Badge, Dialog, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api-client';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { useInstrumentAction } from './use-instrument';

export const RELEASE_TONE = {
  REQUESTED: 'amber',
  RECOMMENDED: 'purple',
  APPROVED: 'blue',
  EXECUTED: 'green',
  REJECTED: 'red',
} as const;

export function ChecklistView({ items }: { items: ReleaseChecklistItem[] }) {
  const t = useTranslations('releases');
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.code} className="flex items-start gap-2 text-sm">
          {i.passed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="passed" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-label="failed" />
          )}
          <span>
            <span className="font-medium text-slate-900">
              {t.has(`checks.${i.code}`) ? t(`checks.${i.code}`) : i.code}
            </span>
            <span className="block text-xs text-slate-600">{i.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Release status timeline (visible to the institution) and the release actions for each role. */
export function ReleasePanel({ inst }: { inst: InstrumentDetail }) {
  const t = useTranslations();
  const canRequest = inst.allowedActions.includes('request_release');
  const [requesting, setRequesting] = useState(false);
  if (inst.releases.length === 0 && !canRequest) return null;
  const current =
    inst.releases.find((r) => r.status !== 'REJECTED' && r.status !== 'EXECUTED') ??
    inst.releases[0];

  return (
    <Card>
      <CardHeader
        title={t('releases.panelTitle')}
        actions={
          canRequest && (
            <Button size="sm" onClick={() => setRequesting(true)}>
              <HandCoins className="h-4 w-4" aria-hidden />
              {t('releases.request')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        {current && <ReleaseCard r={current} inst={inst} />}
        {inst.releases
          .filter((r) => r.id !== current?.id)
          .map((r) => (
            <details key={r.id} className="rounded border border-slate-200 p-2 text-sm">
              <summary className="cursor-pointer">
                <Badge tone={RELEASE_TONE[r.status]}>{t(`releases.steps.${r.status}`)}</Badge>{' '}
                {formatDate(r.requestedAt)} — {r.reason}
              </summary>
              <div className="mt-2">
                <ReleaseCard r={r} inst={inst} readOnly />
              </div>
            </details>
          ))}
      </CardBody>
      {requesting && <RequestDialog inst={inst} onClose={() => setRequesting(false)} />}
    </Card>
  );
}

function ReleaseCard({
  r,
  inst,
  readOnly,
}: {
  r: ReleaseView;
  inst: InstrumentDetail;
  readOnly?: boolean;
}) {
  const t = useTranslations();
  const act = useInstrumentAction(inst.id);
  const [decision, setDecision] = useState<'recommend' | 'decline' | 'approve' | 'reject' | null>(
    null,
  );
  const [executing, setExecuting] = useState(false);
  const a = new Set(readOnly ? [] : inst.allowedActions);

  const steps: {
    key: 'REQUESTED' | 'RECOMMENDED' | 'APPROVED' | 'EXECUTED';
    who: string | null;
    at: string | null;
    note?: string | null;
  }[] = [
    { key: 'REQUESTED', who: r.requestedBy, at: r.requestedAt, note: r.reason },
    { key: 'RECOMMENDED', who: r.recommendedBy, at: r.recommendedAt, note: r.recommendationNote },
    {
      key: 'APPROVED',
      who: r.status === 'REJECTED' ? null : r.decidedBy,
      at: r.status === 'REJECTED' ? null : r.decidedAt,
      note: r.status === 'REJECTED' ? null : r.decisionNote,
    },
    {
      key: 'EXECUTED',
      who: r.executedBy,
      at: r.executedAt,
      note: r.executionRef ? `${r.executionRef} · ${formatDate(r.executionDate)}` : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RELEASE_TONE[r.status]}>{t(`releases.statuses.${r.status}`)}</Badge>
        {r.checklistPassed ? (
          <Badge tone="green">{t('releases.checklistPassed')}</Badge>
        ) : (
          <Badge tone="red">
            {t('releases.checklistFailed', { count: r.checklist.filter((c) => !c.passed).length })}
          </Badge>
        )}
      </div>

      <ol className="grid gap-3 sm:grid-cols-4" aria-label={t('releases.panelTitle')}>
        {steps.map((s) => {
          const done = !!s.at;
          return (
            <li
              key={s.key}
              className={cn(
                'rounded-md border p-2 text-xs',
                done ? 'border-green-300 bg-green-50' : 'border-slate-200',
              )}
            >
              <p className="flex items-center gap-1 font-semibold text-slate-900">
                {done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-700" aria-hidden />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                )}
                {t(`releases.steps.${s.key}`)}
              </p>
              {done && (
                <p className="mt-0.5 text-slate-600">
                  {t('releases.by', { who: s.who ?? '—', when: formatDateTime(s.at) })}
                </p>
              )}
              {s.note && <p className="mt-1 text-slate-800">{s.note}</p>}
            </li>
          );
        })}
      </ol>
      {r.status === 'REJECTED' && (
        <Alert tone="error" title={t('releases.steps.REJECTED')}>
          {r.decisionNote} — {r.decidedBy} ({formatDateTime(r.decidedAt)})
        </Alert>
      )}

      <div>
        <p className="mb-1 text-sm font-semibold text-slate-800">{t('releases.checklist')}</p>
        <ChecklistView items={r.checklist} />
      </div>

      {(a.has('recommend_release') || a.has('approve_release') || a.has('execute_release')) && (
        <div className="flex flex-wrap gap-2">
          {a.has('recommend_release') && (
            <>
              <Button onClick={() => setDecision('recommend')}>{t('releases.recommend')}</Button>
              <Button
                variant="ghost"
                className="text-red-700"
                onClick={() => setDecision('decline')}
              >
                {t('releases.decline')}
              </Button>
            </>
          )}
          {a.has('approve_release') && (
            <>
              <Button variant="success" onClick={() => setDecision('approve')}>
                {t('releases.approve')}
              </Button>
              <Button
                variant="ghost"
                className="text-red-700"
                onClick={() => setDecision('reject')}
              >
                {t('releases.reject')}
              </Button>
            </>
          )}
          {a.has('execute_release') && (
            <Button onClick={() => setExecuting(true)}>{t('releases.execute')}</Button>
          )}
        </div>
      )}
      {r.status === 'RECOMMENDED' && (
        <p className="text-xs text-slate-500">{t('releases.makerChecker')}</p>
      )}

      <ConfirmDialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision ? t(`releases.${decision}`) : ''}
        confirmLabel={decision ? t(`releases.${decision}`) : ''}
        variant={
          decision === 'decline' || decision === 'reject'
            ? 'danger'
            : decision === 'approve'
              ? 'success'
              : 'primary'
        }
        note={{ label: t('releases.decisionNote'), required: true }}
        loading={act.isPending}
        onConfirm={(note) =>
          act.mutate(
            {
              path: `/api/releases/${r.id}/${decision}`,
              body: { note },
              success: t('releases.done'),
            },
            { onSettled: () => setDecision(null) },
          )
        }
      >
        {decision === 'recommend' && !r.checklistPassed && (
          <Alert tone="warning">
            {t('releases.checklistFailed', { count: r.checklist.filter((c) => !c.passed).length })}
          </Alert>
        )}
      </ConfirmDialog>
      {executing && (
        <ExecuteDialog
          releaseId={r.id}
          instrumentId={inst.id}
          onClose={() => setExecuting(false)}
        />
      )}
    </div>
  );
}

function RequestDialog({ inst, onClose }: { inst: InstrumentDetail; onClose: () => void }) {
  const t = useTranslations();
  const act = useInstrumentAction(inst.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const { data } = useQuery({
    queryKey: ['release-checklist', inst.id],
    queryFn: () =>
      api<{ items: ReleaseChecklistItem[]; passed: boolean }>(
        `/api/instruments/${inst.id}/release-checklist`,
      ),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('releases.requestTitle')}
      description={t('releases.requestHelp')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={act.isPending}
            onClick={() => {
              if (reason.trim().length < 10) return setError(t('common.required'));
              act.mutate(
                {
                  path: `/api/instruments/${inst.id}/release`,
                  body: { reason },
                  success: t('releases.requested'),
                },
                { onSuccess: onClose },
              );
            }}
          >
            {t('releases.request')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('releases.reason')} required error={error}>
          {(p) => (
            <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
        <div>
          <p className="mb-1 text-sm font-semibold">{t('releases.checklist')}</p>
          {data ? <ChecklistView items={data.items} /> : <Spinner />}
        </div>
      </div>
    </Dialog>
  );
}

function ExecuteDialog({
  releaseId,
  instrumentId,
  onClose,
}: {
  releaseId: string;
  instrumentId: string;
  onClose: () => void;
}) {
  const t = useTranslations();
  const act = useInstrumentAction(instrumentId);
  const [ref, setRef] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('releases.executeTitle')}
      description={t('releases.executeHelp')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={ref.trim().length < 3 || !date}
            loading={act.isPending}
            onClick={() =>
              act.mutate(
                {
                  path: `/api/releases/${releaseId}/execute`,
                  body: { executionRef: ref, executionDate: date },
                  success: t('releases.done'),
                },
                { onSuccess: onClose },
              )
            }
          >
            {t('releases.execute')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('releases.executionRef')} required>
          {(p) => <Input {...p} value={ref} onChange={(e) => setRef(e.target.value)} />}
        </Field>
        <Field label={t('releases.executionDate')} required>
          {(p) => (
            <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
