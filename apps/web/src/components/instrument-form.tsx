'use client';

import {
  INSTRUMENT_TYPES,
  InstrumentDeclarationSchema,
  type InstrumentDeclaration,
} from '@nidhisetu/shared';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/misc';
import { useBanks } from '@/lib/master-data';

export interface FormValues {
  type: string;
  bankCode: string;
  branch: string;
  ifsc: string;
  fdrNumber: string;
  amount: string;
  issueDate: string;
  maturityDate: string;
  depositorNames: string;
  lienMarked: boolean;
  autoRenewal: boolean;
}

export const EMPTY_FORM: FormValues = {
  type: 'FDR',
  bankCode: '',
  branch: '',
  ifsc: '',
  fdrNumber: '',
  amount: '',
  issueDate: '',
  maturityDate: '',
  depositorNames: 'AICTE\n',
  lienMarked: true,
  autoRenewal: false,
};

export function toFormValues(
  d: Partial<Record<keyof FormValues, string | boolean | null>>,
): FormValues {
  return {
    ...EMPTY_FORM,
    ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined)),
    depositorNames:
      typeof d.depositorNames === 'string'
        ? d.depositorNames
            .split(';')
            .map((s) => s.trim())
            .join('\n')
        : EMPTY_FORM.depositorNames,
  };
}

/**
 * Instrument declaration form. Validation uses the same zod schema as the API, so the user sees
 * exactly the errors the server would return.
 */
export function InstrumentForm({
  initial = EMPTY_FORM,
  submitLabel,
  onSubmit,
  aside,
  highlight,
}: {
  initial?: FormValues;
  submitLabel: string;
  onSubmit: (d: InstrumentDeclaration) => Promise<void>;
  /** Extra content shown above the fields (e.g. OCR pre-fill). */
  aside?: ReactNode;
  /** Field names to highlight for review (e.g. low-confidence OCR values). */
  highlight?: Partial<Record<keyof FormValues, string>>;
}) {
  const t = useTranslations();
  const { banks } = useBanks();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) =>
    setValues((s) => ({ ...s, [k]: v }));
  const text = (k: Exclude<keyof FormValues, 'lienMarked' | 'autoRenewal'>) => ({
    value: values[k],
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = InstrumentDeclarationSchema.safeParse({
      ...values,
      depositorNames: values.depositorNames
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      document.getElementById(`f-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hl = (k: keyof FormValues) =>
    highlight?.[k] ? 'ring-2 ring-amber-400 ring-offset-1' : undefined;
  const hint = (k: keyof FormValues, base?: ReactNode) =>
    highlight?.[k] ? <span className="font-medium text-amber-800">{highlight[k]}</span> : base;

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      {aside}
      {formError && <Alert tone="error">{formError}</Alert>}
      <Card>
        <CardHeader title={t('instruments.sectionDeposit')} as="h2" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field id="f-type" label={t('fields.type')} error={errors.type} required>
            {(p) => (
              <Select {...p} {...text('type')}>
                {INSTRUMENT_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`instrumentTypes.${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            id="f-fdrNumber"
            label={t('fields.fdrNumber')}
            error={errors.fdrNumber}
            hint={hint('fdrNumber')}
            required
          >
            {(p) => (
              <Input {...p} className={hl('fdrNumber')} autoComplete="off" {...text('fdrNumber')} />
            )}
          </Field>
          <Field
            id="f-amount"
            label={t('fields.amount')}
            error={errors.amount}
            hint={hint('amount')}
            required
          >
            {(p) => (
              <Input {...p} className={hl('amount')} inputMode="decimal" {...text('amount')} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              id="f-issueDate"
              label={t('fields.issueDate')}
              error={errors.issueDate}
              hint={hint('issueDate')}
              required
            >
              {(p) => (
                <Input {...p} className={hl('issueDate')} type="date" {...text('issueDate')} />
              )}
            </Field>
            <Field
              id="f-maturityDate"
              label={t('fields.maturityDate')}
              error={errors.maturityDate}
              hint={hint('maturityDate')}
              required
            >
              {(p) => (
                <Input
                  {...p}
                  className={hl('maturityDate')}
                  type="date"
                  {...text('maturityDate')}
                />
              )}
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('instruments.sectionBank')} as="h2" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field
            id="f-bankCode"
            label={t('fields.bankCode')}
            error={errors.bankCode}
            hint={hint('bankCode')}
            required
          >
            {(p) => (
              <Select {...p} className={hl('bankCode')} {...text('bankCode')}>
                <option value="">{t('instruments.selectBank')}</option>
                {banks.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="f-branch" label={t('fields.branch')} error={errors.branch} required>
            {(p) => <Input {...p} {...text('branch')} />}
          </Field>
          <Field
            id="f-ifsc"
            label={t('fields.ifsc')}
            error={errors.ifsc}
            hint={hint('ifsc')}
            required
          >
            {(p) => (
              <Input
                {...p}
                className={`font-mono uppercase ${hl('ifsc') ?? ''}`}
                maxLength={11}
                {...text('ifsc')}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('instruments.sectionBeneficiary')} as="h2" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            id="f-depositorNames"
            label={t('fields.depositorNames')}
            error={errors.depositorNames}
            hint={hint('depositorNames', t('instruments.depositorNamesHint'))}
            required
          >
            {(p) => (
              <Textarea
                {...p}
                className={hl('depositorNames')}
                rows={3}
                {...text('depositorNames')}
              />
            )}
          </Field>
          <fieldset className="space-y-3">
            <legend className="sr-only">{t('instruments.sectionBeneficiary')}</legend>
            {(['lienMarked', 'autoRenewal'] as const).map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-400 accent-brand-700"
                  checked={values[k]}
                  onChange={(e) => set(k, e.target.checked)}
                />
                {t(`fields.${k}`)}
              </label>
            ))}
          </fieldset>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={busy} size="lg">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
