'use client';

import type { InstrumentDetail } from '@nidhisetu/shared';
import { Pencil, Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { useInstrumentAction } from './use-instrument';

export type DialogKind = 'submit' | 'delete' | null;

/**
 * Buttons for what the current user may do now. The list comes from the API (`allowedActions`),
 * so the UI never offers an action the server would refuse.
 */
export function ActionBar({ inst, extra }: { inst: InstrumentDetail; extra?: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const act = useInstrumentAction(inst.id);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const a = new Set(inst.allowedActions);
  const hasScan = inst.documents.some((d) => d.type === 'FDR_SCAN');
  const has = a.has('edit') || a.has('submit') || a.has('delete') || !!extra;

  return (
    <Card>
      <CardHeader title={t('instruments.actions')} />
      <CardBody className="space-y-3">
        {!has && <p className="text-sm text-slate-600">{t('instruments.noActions')}</p>}
        {a.has('submit') && !hasScan && <Alert tone="warning">{t('instruments.submitHint')}</Alert>}
        <div className="flex flex-wrap gap-2">
          {a.has('submit') && (
            <Button onClick={() => setDialog('submit')}>
              <Send className="h-4 w-4" aria-hidden />
              {t('instruments.submit')}
            </Button>
          )}
          {a.has('edit') && (
            <Link
              href={`/instruments/${inst.id}/edit`}
              className={buttonVariants({ variant: 'secondary' })}
            >
              <Pencil className="h-4 w-4" aria-hidden />
              {t('common.edit')}
            </Link>
          )}
          {a.has('delete') && (
            <Button variant="ghost" className="text-red-700" onClick={() => setDialog('delete')}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t('instruments.deleteDraft')}
            </Button>
          )}
          {extra}
        </div>
      </CardBody>

      <ConfirmDialog
        open={dialog === 'submit'}
        onClose={() => setDialog(null)}
        title={t('instruments.submit')}
        description={t('instruments.submitConfirm')}
        confirmLabel={t('instruments.submit')}
        loading={act.isPending}
        onConfirm={() =>
          act.mutate(
            { path: `/api/instruments/${inst.id}/submit`, success: t('instruments.submitted') },
            { onSettled: () => setDialog(null) },
          )
        }
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={t('instruments.deleteDraft')}
        description={t('instruments.deleteConfirm')}
        confirmLabel={t('common.delete')}
        variant="danger"
        loading={act.isPending}
        onConfirm={() =>
          act.mutate(
            {
              path: `/api/instruments/${inst.id}`,
              method: 'DELETE',
              success: t('instruments.deleted'),
            },
            { onSuccess: () => router.replace('/instruments'), onSettled: () => setDialog(null) },
          )
        }
      />
    </Card>
  );
}
