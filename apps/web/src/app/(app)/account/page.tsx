'use client';

import { ChangePasswordSchema } from '@nidhisetu/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Alert, Badge, PageHeader, Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';
import { useMe } from '@/lib/session';

export default function AccountPage() {
  const t = useTranslations();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({});
  const [busy, setBusy] = useState(false);

  if (!me) return <Spinner />;
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ChangePasswordSchema.safeParse(values);
    const errs: typeof errors = {};
    if (!parsed.success)
      for (const i of parsed.error.issues) errs[i.path[0] as keyof typeof values] ??= i.message;
    if (values.confirm !== values.newPassword) errs.confirm = t('account.mismatch');
    setErrors(errs);
    if (!parsed.success || errs.confirm) return;
    setBusy(true);
    try {
      const wasForced = me.mustChangePassword;
      await api('/api/auth/password', { body: parsed.data });
      toast.success(t('account.changed'));
      setValues({ currentPassword: '', newPassword: '', confirm: '' });
      await qc.invalidateQueries({ queryKey: ['me'] });
      if (wasForced) router.replace('/dashboard');
    } catch (err) {
      setErrors({ currentPassword: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('account.title')} description={me.email} />
      {me.mustChangePassword && (
        <div className="mb-4">
          <Alert tone="warning" title={t('account.mustChangeTitle')}>
            {t('account.mustChangeBody')}
          </Alert>
        </div>
      )}
      <div className="space-y-4">
        <Card>
          <CardHeader title={t('account.profile')} />
          <CardBody>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-600">{t('account.name')}</dt>
                <dd className="font-medium text-slate-900">{me.name}</dd>
              </div>
              <div>
                <dt className="text-slate-600">{t('account.role')}</dt>
                <dd className="font-medium text-slate-900">{t(`roles.${me.role}`)}</dd>
              </div>
              <div>
                <dt className="text-slate-600">{t('account.mfa')}</dt>
                <dd>
                  <Badge tone={me.mfaEnabled ? 'green' : 'slate'}>
                    {me.mfaEnabled ? t('account.mfaOn') : t('account.mfaOff')}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('account.changeTitle')} description={t('account.policy')} />
          <CardBody>
            <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
              <Field label={t('account.current')} error={errors.currentPassword} required>
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="current-password"
                    value={values.currentPassword}
                    onChange={set('currentPassword')}
                  />
                )}
              </Field>
              <Field label={t('account.new')} error={errors.newPassword} required>
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={values.newPassword}
                    onChange={set('newPassword')}
                  />
                )}
              </Field>
              <Field label={t('account.confirm')} error={errors.confirm} required>
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={values.confirm}
                    onChange={set('confirm')}
                  />
                )}
              </Field>
              <div className="flex justify-end">
                <Button type="submit" loading={busy}>
                  {t('account.save')}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
