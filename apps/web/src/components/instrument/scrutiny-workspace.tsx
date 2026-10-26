'use client';

import type { FieldKey, FieldView, InstrumentDetail } from '@nidhisetu/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCheck, Check, PenLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Alert, Dialog, Spinner } from '@/components/ui/misc';
import { useBanks } from '@/lib/master-data';
import { documentUrl, DocumentViewer } from './documents-panel';
import { FieldsPanel } from './fields-panel';
import { useInstrumentAction } from './use-instrument';

const isConfirmed = (f: FieldView) =>
  !f.mismatch && (f.effectiveTrust === 'OFFICER_VERIFIED' || f.effectiveTrust === 'BANK_CONFIRMED');

/** Side-by-side document viewer and field verification (Section 7 · cap 3). */
export function ScrutinyWorkspace({ inst }: { inst: InstrumentDetail }) {
  const t = useTranslations();
  const act = useInstrumentAction(inst.id);
  const [correcting, setCorrecting] = useState<FieldView | null>(null);
  const canVerify = inst.allowedActions.includes('verify_field');
  const scan = inst.documents.find((d) => d.type === 'FDR_SCAN' && !d.supersededBy);
  const pending = inst.fields.filter(
    (f) => !isConfirmed(f) && f.effectiveValue !== null && !f.mismatch,
  );

  const { data: url, isLoading } = useQuery({
    queryKey: ['doc-url', scan?.id],
    queryFn: () => documentUrl(scan!.id, true),
    enabled: !!scan,
    staleTime: 240_000,
  });

  const verify = (items: { field: FieldKey; value?: string }[], label: string) =>
    act.mutate({
      path: `/api/instruments/${inst.id}/verify-fields`,
      body: { items },
      success: label,
    });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card className="xl:sticky xl:top-24 xl:self-start">
        <CardHeader
          title={t('scrutiny.original')}
          description={scan ? scan.originalName : undefined}
        />
        <CardBody>
          {!scan ? (
            <Alert tone="warning">{t('scrutiny.noScan')}</Alert>
          ) : isLoading || !url ? (
            <Spinner />
          ) : (
            <DocumentViewer
              url={url}
              mimeType={scan.mimeType}
              title={scan.originalName}
              className="h-[65vh] w-full rounded border object-contain"
            />
          )}
        </CardBody>
      </Card>

      <div className="space-y-3">
        {canVerify && pending.length > 0 && (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              loading={act.isPending}
              onClick={() =>
                verify(
                  pending.map((f) => ({ field: f.field })),
                  t('scrutiny.verified'),
                )
              }
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              {t('scrutiny.verifyAll')} ({pending.length})
            </Button>
          </div>
        )}
        <FieldsPanel
          inst={inst}
          renderAction={
            canVerify
              ? (f) =>
                  isConfirmed(f) ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-800">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      {t('scrutiny.verified')}
                    </span>
                  ) : (
                    <div className="flex justify-end gap-1">
                      {f.effectiveValue !== null && !f.mismatch && (
                        <Button
                          size="sm"
                          variant="secondary"
                          title={t('scrutiny.verifyHint')}
                          aria-label={`${t('scrutiny.verify')}: ${t(`fields.${f.field}`)}`}
                          onClick={() =>
                            verify(
                              [{ field: f.field }],
                              t('scrutiny.fieldVerified', { field: t(`fields.${f.field}`) }),
                            )
                          }
                        >
                          <Check className="h-4 w-4" aria-hidden />
                          {t('scrutiny.verify')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${t('scrutiny.correct')} ${t(`fields.${f.field}`)}`}
                        onClick={() => setCorrecting(f)}
                      >
                        <PenLine className="h-4 w-4" aria-hidden />
                        {t('scrutiny.correct')}
                      </Button>
                    </div>
                  )
              : undefined
          }
        />
      </div>

      <CorrectDialog
        field={correcting}
        onClose={() => setCorrecting(null)}
        loading={act.isPending}
        onSave={(value) =>
          act.mutate(
            {
              path: `/api/instruments/${inst.id}/verify-fields`,
              body: { items: [{ field: correcting!.field, value }] },
              success: t('scrutiny.fieldVerified', { field: t(`fields.${correcting!.field}`) }),
            },
            { onSuccess: () => setCorrecting(null) },
          )
        }
      />
    </div>
  );
}

function CorrectDialog({
  field,
  onClose,
  onSave,
  loading,
}: {
  field: FieldView | null;
  onClose: () => void;
  onSave: (value: string) => void;
  loading: boolean;
}) {
  const t = useTranslations();
  const { banks } = useBanks();
  const [value, setValue] = useState('');
  const [lastField, setLastField] = useState<string | null>(null);
  if (field && field.field !== lastField) {
    setLastField(field.field);
    setValue(field.effectiveValue ?? '');
  }
  if (!field) return null;
  const label = t(`fields.${field.field}`);

  return (
    <Dialog
      open={!!field}
      onClose={onClose}
      title={t('scrutiny.correctTitle')}
      description={t('scrutiny.correctHelp', { field: label })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={loading} disabled={!value.trim()} onClick={() => onSave(value)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={`${t('scrutiny.valueOnOriginal')}: ${label}`} required>
        {(p) =>
          field.field === 'lienMarked' || field.field === 'autoRenewal' ? (
            <Select {...p} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="true">{t('common.yes')}</option>
              <option value="false">{t('common.no')}</option>
            </Select>
          ) : field.field === 'bankCode' ? (
            <Select {...p} value={value} onChange={(e) => setValue(e.target.value)}>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} ({b.code})
                </option>
              ))}
            </Select>
          ) : (
            <Input
              {...p}
              type={field.field === 'issueDate' || field.field === 'maturityDate' ? 'date' : 'text'}
              inputMode={field.field === 'amount' ? 'decimal' : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )
        }
      </Field>
    </Dialog>
  );
}
