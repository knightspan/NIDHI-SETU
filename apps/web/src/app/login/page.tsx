'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, TotpCodeSchema, type LoginResult } from '@nidhisetu/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
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
    <div className="dp-login">
      <div className="dp-case dp-login-case">
        <div className="dp-corners" aria-hidden>
          <i className="dp-screw" />
          <i className="dp-screw" />
          <i className="dp-screw" />
          <i className="dp-screw" />
        </div>
        <header className="dp-login-top">
          <p className="dp-meta">{t('app.org')}</p>
          <LocaleSwitcher />
        </header>

        <div className="dp-login-grid">
          <section>
            <div className="dp-vents" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
            <h1 className="dp-display">{t('app.name')}</h1>
            <p className="dp-reading">{t('app.tagline')}</p>
          </section>

          <Card className="w-full p-6 sm:p-8">
            {step.kind === 'password' && (
              <form onSubmit={(e) => void onPassword(e)} noValidate className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-ink">
                    {t('auth.signInTitle')}
                  </h2>
                  <p className="dp-reading">{t('auth.signInSubtitle')}</p>
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
                <Button
                  type="submit"
                  className="dp-dialbtn h-16 w-full justify-start"
                  loading={pwForm.formState.isSubmitting}
                >
                  <span className="dp-dial" aria-hidden>
                    <ArrowRight className="h-5 w-5" />
                  </span>
                  {t('auth.signIn')}
                </Button>
                <p className="dp-meta text-center">{t('auth.demoAccounts')}</p>
              </form>
            )}

            {step.kind !== 'password' && (
              <form onSubmit={(e) => void onCode(e)} noValidate className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-ink">
                    {step.kind === 'mfa' ? t('auth.mfaTitle') : t('auth.enrolTitle')}
                  </h2>
                  <p className="dp-reading">
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
                    <p className="dp-meta">{t('auth.manualKey')}</p>
                    <code className="dp-well px-2 py-1 font-mono text-sm break-all">
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
                <Button
                  type="submit"
                  className="dp-dialbtn h-16 w-full justify-start"
                  loading={codeForm.formState.isSubmitting}
                >
                  <span className="dp-dial" aria-hidden>
                    <ArrowRight className="h-5 w-5" />
                  </span>
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
        </div>
        <footer className="dp-login-foot dp-meta">{t('app.demoBanner')}</footer>
      </div>
    </div>
  );
}
