'use client';

import type { InstrumentDetail } from '@nidhisetu/shared';
import {
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Pencil,
  RefreshCw,
  Reply,
  Send,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button, buttonVariants, type ButtonProps } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { useInstrumentAction } from './use-instrument';

interface ActionDef {
  /** Key in InstrumentDetail.allowedActions that enables this button. */
  action: string;
  label: string;
  icon: LucideIcon;
  variant?: ButtonProps['variant'];
  /** Navigate instead of calling the API. */
  href?: string;
  path?: string;
  method?: 'POST' | 'DELETE';
  confirm?: { title: string; description?: string; note?: { label: string; required?: boolean } };
  success?: string;
  hint?: string;
  /** Extra condition on top of allowedActions. */
  when?: (inst: InstrumentDetail) => boolean;
  after?: 'list';
}

/**
 * Buttons for what the current user may do now. The list comes from the API (`allowedActions`),
 * so the UI never offers an action the server would refuse.
 */
export function ActionBar({ inst, extra }: { inst: InstrumentDetail; extra?: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const act = useInstrumentAction(inst.id);
  const [pending, setPending] = useState<ActionDef | null>(null);
  const base = `/api/instruments/${inst.id}`;
  const openCount = inst.discrepancies.filter((d) => d.status === 'OPEN').length;

  const defs: ActionDef[] = [
    // Institution
    {
      action: 'submit',
      label: t('instruments.submit'),
      icon: Send,
      path: `${base}/submit`,
      confirm: { title: t('instruments.submit'), description: t('instruments.submitConfirm') },
      success: t('instruments.submitted'),
      hint: inst.documents.some((d) => d.type === 'FDR_SCAN')
        ? undefined
        : t('instruments.submitHint'),
    },
    {
      action: 'respond',
      label: t('scrutiny.respond'),
      icon: Reply,
      path: `${base}/respond`,
      confirm: {
        title: t('scrutiny.respond'),
        description: t('scrutiny.respondHint'),
        note: { label: t('common.notes') },
      },
      success: t('scrutiny.responded'),
      hint: t('scrutiny.respondHint'),
    },
    {
      action: 'edit',
      label: t('common.edit'),
      icon: Pencil,
      variant: 'secondary',
      href: `/instruments/${inst.id}/edit`,
    },
    {
      action: 'renew',
      label: t('renewals.renew'),
      icon: RefreshCw,
      variant: 'secondary',
      href: `/instruments/${inst.id}/renew`,
    },
    {
      action: 'delete',
      label: t('instruments.deleteDraft'),
      icon: Trash2,
      variant: 'ghost',
      path: base,
      method: 'DELETE',
      confirm: { title: t('instruments.deleteDraft'), description: t('instruments.deleteConfirm') },
      success: t('instruments.deleted'),
      after: 'list',
    },
    // Regional officer
    {
      action: 'begin_scrutiny',
      label: t('scrutiny.beginScrutiny'),
      icon: ClipboardCheck,
      path: `${base}/begin-scrutiny`,
      success: t('scrutiny.begun'),
    },
    {
      action: 'raise_discrepancy',
      label: t('scrutiny.returnToInstitution'),
      icon: Undo2,
      variant: 'secondary',
      path: `${base}/return`,
      confirm: { title: t('scrutiny.returnToInstitution'), note: { label: t('common.notes') } },
      success: t('scrutiny.returned'),
      when: (i) => i.status === 'UNDER_SCRUTINY' && openCount > 0,
    },
    {
      action: 'verify',
      label: t('scrutiny.markVerified'),
      icon: CheckCircle2,
      variant: 'success',
      path: `${base}/verify`,
      success: t('scrutiny.markedVerified'),
      hint: t('scrutiny.markVerifiedHint'),
    },
    {
      action: 'reject',
      label: t('scrutiny.reject'),
      icon: Ban,
      variant: 'ghost',
      path: `${base}/reject`,
      confirm: {
        title: t('scrutiny.reject'),
        description: t('scrutiny.rejectConfirm'),
        note: { label: t('common.reason'), required: true },
      },
      success: t('scrutiny.rejected'),
    },
  ];

  const visible = defs.filter(
    (d) => inst.allowedActions.includes(d.action) && (!d.when || d.when(inst)),
  );
  const hints = visible.map((d) => d.hint).filter(Boolean);

  const run = (d: ActionDef, note?: string) =>
    act.mutate(
      {
        path: d.path!,
        method: d.method ?? 'POST',
        body: d.method === 'DELETE' ? undefined : note ? { note } : {},
        success: d.success,
      },
      {
        onSuccess: () => d.after === 'list' && router.replace('/instruments'),
        onSettled: () => setPending(null),
      },
    );

  return (
    <Card>
      <CardHeader title={t('instruments.actions')} />
      <CardBody className="space-y-3">
        {visible.length === 0 && !extra && (
          <p className="text-sm text-slate-600">{t('instruments.noActions')}</p>
        )}
        {hints.map((h) => (
          <Alert key={h} tone="info">
            {h}
          </Alert>
        ))}
        <div className="flex flex-wrap gap-2">
          {visible.map((d) =>
            d.href ? (
              <Link
                key={d.action}
                href={d.href}
                className={buttonVariants({ variant: d.variant ?? 'primary' })}
              >
                <d.icon className="h-4 w-4" aria-hidden />
                {d.label}
              </Link>
            ) : (
              <Button
                key={d.action}
                variant={d.variant}
                className={d.variant === 'ghost' ? 'text-red-700' : undefined}
                loading={act.isPending && pending === d}
                onClick={() => (d.confirm ? setPending(d) : (setPending(d), run(d)))}
              >
                <d.icon className="h-4 w-4" aria-hidden />
                {d.label}
              </Button>
            ),
          )}
          {extra}
        </div>
      </CardBody>
      <ConfirmDialog
        open={!!pending?.confirm}
        onClose={() => setPending(null)}
        title={pending?.confirm?.title ?? ''}
        description={pending?.confirm?.description}
        confirmLabel={pending?.label ?? ''}
        variant={pending?.variant === 'ghost' ? 'danger' : (pending?.variant ?? 'primary')}
        note={pending?.confirm?.note}
        loading={act.isPending}
        onConfirm={(note) => pending && run(pending, note || undefined)}
      />
    </Card>
  );
}
