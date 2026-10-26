'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, TotpCodeSchema, type LoginResult } from '@nidhisetu/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';

type Step =
  { kind: 'password' } | { kind: 'mfa' } | { kind: 'enrol'; qrDataUrl: string; secret: string };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
    const next = params.get('next');
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
  };

  const pwForm = useForm<z.input<typeof LoginSchema>>({ resolver: zodResolver(LoginSchema) });
  const codeForm = useForm<z.input<typeof TotpCodeSchema>>({
    resolver: zodResolver(TotpCodeSchema),
  });

  const onPassword = pwForm.handleSubmit(async (values) => {
    setError(null);
    try {
      const r = await api<LoginResult>('/api/auth/login', { body: values, noRefresh: true });
      if (r.status === 'OK') return done();
      if (r.status === 'MFA_REQUIRED') setStep({ kind: 'mfa' });
      else setStep({ kind: 'enrol', qrDataUrl: r.qrDataUrl, secret: r.secret });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  const onCode = codeForm.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/api/auth/mfa/verify', { body: values, noRefresh: true });
      await done();
    } catch (e) {
      setError(errorMessage(e));
      codeForm.reset();
    }
  });

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-brand-50 to-slate-50">
      <header className="flex items-center justify-between px-4 py-3 sm:px-8">
        <div className="flex items-center gap-2 text-brand-900">
          <ShieldCheck className="h-6 w-6" aria-hidden />
          <span className="font-bold">{t('app.name')}</span>
          <span className="hidden text-sm text-slate-600 sm:inline">· {t('app.org')}</span>
        </div>
        <LocaleSwitcher />
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md p-6 sm:p-8">
          {step.kind === 'password' && (
            <form onSubmit={(e) => void onPassword(e)} noValidate className="space-y-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">{t('auth.signInTitle')}</h1>
                <p className="mt-1 text-sm text-slate-600">{t('auth.signInSubtitle')}</p>
              </div>
              {error && <Alert tone="error">{error}</Alert>}
              <Field
                label={t('auth.email')}
                error={pwForm.formState.errors.email?.message}
                required
              >
                {(p) => (
                  <Input
                    type="email"
                    autoComplete="username"
                    {...p}
                    {...pwForm.register('email')}
                  />
                )}
              </Field>
              <Field
                label={t('auth.password')}
                error={pwForm.formState.errors.password?.message}
                required
              >
                {(p) => (
                  <Input
                    type="password"
                    autoComplete="current-password"
                    {...p}
                    {...pwForm.register('password')}
                  />
                )}
              </Field>
              <Button type="submit" className="w-full" loading={pwForm.formState.isSubmitting}>
                {t('auth.signIn')}
              </Button>
              <p className="text-center text-xs text-slate-500">{t('auth.demoAccounts')}</p>
            </form>
          )}

          {step.kind !== 'password' && (
            <form onSubmit={(e) => void onCode(e)} noValidate className="space-y-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  {step.kind === 'mfa' ? t('auth.mfaTitle') : t('auth.enrolTitle')}
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  {step.kind === 'mfa' ? t('auth.mfaSubtitle') : t('auth.enrolSubtitle')}
                </p>
              </div>
              {step.kind === 'enrol' && (
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the API */}
                  <img
                    src={step.qrDataUrl}
                    alt="QR code for authenticator app"
                    width={180}
                    height={180}
                  />
                  <p className="text-xs text-slate-600">{t('auth.manualKey')}</p>
                  <code className="rounded bg-slate-100 px-2 py-1 font-mono text-sm break-all">
                    {step.secret}
                  </code>
                </div>
              )}
              {error && <Alert tone="error">{error}</Alert>}
              <Field
                label={t('auth.code')}
                error={codeForm.formState.errors.code?.message}
                required
              >
                {(p) => (
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    className="text-center font-mono text-lg tracking-[0.5em]"
                    {...p}
                    {...codeForm.register('code')}
                  />
                )}
              </Field>
              <Button type="submit" className="w-full" loading={codeForm.formState.isSubmitting}>
                {t('auth.verify')}
              </Button>
              <Button
                variant="link"
                className="w-full"
                onClick={() => {
                  setStep({ kind: 'password' });
                  setError(null);
                }}
              >
                {t('auth.startOver')}
              </Button>
            </form>
          )}
        </Card>
      </main>
      <footer className="px-4 py-3 text-center text-xs text-slate-500">
        {t('app.demoBanner')}
      </footer>
    </div>
  );
}
