'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, type Locale } from '@/i18n/locales';

const LABELS: Record<Locale, string> = { en: 'English', hi: 'हिन्दी' };

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const t = useTranslations('common');
  const next: Locale = locale === 'en' ? 'hi' : 'en';
  return (
    <button
      type="button"
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100'
      }
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      aria-label={`${t('language')}: ${LABELS[next]}`}
      lang={next}
    >
      <Languages className="h-4 w-4" aria-hidden />
      {LABELS[next]}
    </button>
  );
}
