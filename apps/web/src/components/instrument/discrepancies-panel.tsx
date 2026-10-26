'use client';

import {
  FIELD_KEYS,
  SEVERITIES,
  type DiscrepancyView,
  type InstrumentDetail,
  type Severity,
} from '@nidhisetu/shared';
import { AlertOctagon, Bot, CheckCircle2, MessageSquare, Plus, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Badge, Dialog, EmptyState } from '@/components/ui/misc';
import { useMe } from '@/lib/session';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { useInstrumentAction } from './use-instrument';

export const SEVERITY_TONE: Record<Severity, 'red' | 'amber' | 'slate'> = {
  HIGH: 'red',
  MEDIUM: 'amber',
  LOW: 'slate',
};
const STATUS_TONE = { OPEN: 'red', RESPONDED: 'blue', RESOLVED: 'green', WAIVED: 'slate' } as const;

export function DiscrepanciesPanel({ inst }: { inst: InstrumentDetail }) {
  const t = useTranslations();
  const { data: me } = useMe();
  const [raising, setRaising] = useState(false);
  const canRaise = inst.allowedActions.includes('raise_discrepancy');
  const items = [...inst.discrepancies].sort((a, b) => rank(a) - rank(b));

  return (
    <Card id="discrepancies">
      <CardHeader
        title={t('discrepancies.panelTitle')}
        actions={
          canRaise && (
            <Button size="sm" variant="secondary" onClick={() => setRaising(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('discrepancies.raise')}
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        {items.length === 0 ? (
          <EmptyState title={t('discrepancies.none')} />
        ) : (
          items.map((d) => (
            <DiscrepancyItem key={d.id} d={d} instrumentId={inst.id} role={me?.role} />
          ))
        )}
      </CardBody>
      <RaiseDialog open={raising} onClose={() => setRaising(false)} inst={inst} />
    </Card>
  );
}

function rank(d: DiscrepancyView): number {
  const s = { OPEN: 0, RESPONDED: 1, RESOLVED: 2, WAIVED: 3 }[d.status];
  const v = { HIGH: 0, MEDIUM: 1, LOW: 2 }[d.severity];
  return s * 10 + v;
}

function DiscrepancyItem({
  d,
  instrumentId,
  role,
}: {
  d: DiscrepancyView;
  instrumentId: string;
  role?: string;
}) {
  const t = useTranslations();
  const act = useInstrumentAction(instrumentId);
  const [reply, setReply] = useState('');
  const [closing, setClosing] = useState<'RESOLVED' | 'WAIVED' | null>(null);
  const isOpen = d.status === 'OPEN' || d.status === 'RESPONDED';
  const canReply = isOpen && (role === 'INSTITUTION_USER' || role === 'RO_OFFICER');
  const overdue = isOpen && d.dueAt && new Date(d.dueAt) < new Date();
  const ruleLabel = t.has(`discrepancies.rules.${d.ruleCode}`)
    ? t(`discrepancies.rules.${d.ruleCode}`)
    : d.ruleCode;

  return (
    <article
      className={cn(
        'rounded-md border p-3',
        d.ruleCode === 'DUPLICATE_FDR' && isOpen
          ? 'border-red-300 bg-red-50/50'
          : 'border-slate-200',
      )}
      aria-label={ruleLabel}
    >
      <header className="flex flex-wrap items-center gap-2">
        {d.ruleCode === 'DUPLICATE_FDR' && (
          <AlertOctagon className="h-4 w-4 text-red-700" aria-hidden />
        )}
        <h3 className="text-sm font-semibold text-slate-900">{ruleLabel}</h3>
        <Badge tone={SEVERITY_TONE[d.severity]}>{t(`severity.${d.severity}`)}</Badge>
        <Badge tone={STATUS_TONE[d.status]}>{t(`discrepancyStatus.${d.status}`)}</Badge>
        {d.field && <span className="text-xs text-slate-500">· {t(`fields.${d.field}`)}</span>}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500">
          {d.autoRaised ? (
            <Bot className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <UserRound className="h-3.5 w-3.5" aria-hidden />
          )}
          {d.autoRaised ? t('discrepancies.auto') : t('discrepancies.manual')} ·{' '}
          {formatDate(d.createdAt)}
        </span>
      </header>
      <p className="mt-1.5 text-sm text-slate-800">{d.description}</p>
      {isOpen && d.dueAt && (
        <p
          className={cn('mt-1 text-xs', overdue ? 'font-semibold text-red-700' : 'text-slate-500')}
        >
          {overdue
            ? t('discrepancies.overdue', { date: formatDate(d.dueAt) })
            : t('discrepancies.due', { date: formatDate(d.dueAt) })}
        </p>
      )}

      {d.comments.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
          {d.comments.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-medium text-slate-900">
                {c.authorName ?? t('roles.SYSTEM')}
              </span>{' '}
              <span className="text-xs text-slate-500">
                ({t.has(`roles.${c.authorRole}`) ? t(`roles.${c.authorRole}`) : c.authorRole}) ·{' '}
                {formatDateTime(c.createdAt)}
              </span>
              <p className="text-slate-800">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      {(canReply || (isOpen && role === 'RO_OFFICER')) && (
        <div className="mt-3 space-y-2">
          {canReply && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!reply.trim()) return;
                act.mutate(
                  {
                    path: `/api/discrepancies/${d.id}/comments`,
                    body: { body: reply },
                    success: t('discrepancies.replied'),
                  },
                  { onSuccess: () => setReply('') },
                );
              }}
            >
              <label className="sr-only" htmlFor={`reply-${d.id}`}>
                {t('discrepancies.reply')}
              </label>
              <Textarea
                id={`reply-${d.id}`}
                rows={1}
                className="min-h-10"
                placeholder={t('discrepancies.replyPlaceholder')}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                loading={act.isPending}
                className="h-10"
              >
                <MessageSquare className="h-4 w-4" aria-hidden />
                {t('discrepancies.send')}
              </Button>
            </form>
          )}
          {isOpen && role === 'RO_OFFICER' && (
            <div className="flex gap-2">
              <Button size="sm" variant="success" onClick={() => setClosing('RESOLVED')}>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {t('discrepancies.resolve')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setClosing('WAIVED')}>
                {t('discrepancies.waive')}
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={closing !== null}
        onClose={() => setClosing(null)}
        title={`${t('discrepancies.closeTitle')}: ${closing === 'WAIVED' ? t('discrepancies.waive') : t('discrepancies.resolve')}`}
        description={d.description}
        confirmLabel={closing === 'WAIVED' ? t('discrepancies.waive') : t('discrepancies.resolve')}
        note={{ label: t('discrepancies.closeNote'), required: true }}
        loading={act.isPending}
        onConfirm={(note) =>
          act.mutate(
            {
              path: `/api/discrepancies/${d.id}/close`,
              body: { resolution: closing, note },
              success: t('discrepancies.closed'),
            },
            { onSettled: () => setClosing(null) },
          )
        }
      />
    </article>
  );
}

function RaiseDialog({
  open,
  onClose,
  inst,
}: {
  open: boolean;
  onClose: () => void;
  inst: InstrumentDetail;
}) {
  const t = useTranslations();
  const act = useInstrumentAction(inst.id);
  const [field, setField] = useState('');
  const [severity, setSeverity] = useState<Severity>('MEDIUM');
  const [description, setDescription] = useState('');
  const [sendBack, setSendBack] = useState(true);
  const [error, setError] = useState<string>();

  const submit = () => {
    if (description.trim().length < 5) return setError(t('common.required'));
    act.mutate(
      {
        path: `/api/instruments/${inst.id}/discrepancies`,
        body: { field: field || null, severity, description, returnToInstitution: sendBack },
        success: t('discrepancies.raised'),
      },
      {
        onSuccess: () => {
          setDescription('');
          setError(undefined);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('discrepancies.raiseTitle')}
      description={t('discrepancies.raiseHelp')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={act.isPending}>
            {t('discrepancies.raise')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('discrepancies.field')}>
            {(p) => (
              <Select {...p} value={field} onChange={(e) => setField(e.target.value)}>
                <option value="">{t('discrepancies.noField')}</option>
                {FIELD_KEYS.map((f) => (
                  <option key={f} value={f}>
                    {t(`fields.${f}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('discrepancies.severity')}>
            {(p) => (
              <Select
                {...p}
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`severity.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('discrepancies.description')} required error={error}>
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        {inst.status === 'UNDER_SCRUTINY' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-700"
              checked={sendBack}
              onChange={(e) => setSendBack(e.target.checked)}
            />
            {t('discrepancies.sendBack')}
          </label>
        )}
      </div>
    </Dialog>
  );
}
