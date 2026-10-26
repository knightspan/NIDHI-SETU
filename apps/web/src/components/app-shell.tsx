'use client';

import { CalendarClock, LogOut, Menu, ShieldCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Spinner } from '@/components/ui/misc';
import { ApiError } from '@/lib/api-client';
import { visibleNav } from '@/lib/nav';
import { useMe, useSignOut } from '@/lib/session';
import { cn, formatDate } from '@/lib/utils';
import { GlobalSearch } from './global-search';
import { NotificationBell } from './notification-bell';

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { data: me, error, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const signOut = useSignOut();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [error, router, pathname]);

  useEffect(() => setMenuOpen(false), [pathname]);

  if (isLoading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }

  const items = visibleNav(me);
  const sections: { id: 'work' | 'oversight' | 'admin'; label?: string }[] = [
    { id: 'work' },
    { id: 'oversight', label: t('nav.sectionOversight') },
    { id: 'admin', label: t('nav.sectionAdmin') },
  ];
  const isActive = (href: string) =>
    href === '/instruments'
      ? pathname === href || /^\/instruments\/(?!new)/.test(pathname)
      : pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav aria-label={t('nav.main')} className="flex flex-col gap-4 p-3">
      {sections.map((s) => {
        const list = items.filter((i) => i.section === s.id);
        if (list.length === 0) return null;
        return (
          <div key={s.id}>
            {s.label && (
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-brand-100/70">
                {s.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {list.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-brand-50 hover:bg-white/10',
                      isActive(item.href) && 'bg-white/15 font-semibold text-white',
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {t(`nav.${item.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:p-2"
      >
        {t('app.skipToContent')}
      </a>

      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col overflow-y-auto bg-brand-900 lg:flex">
        <Brand />
        {nav}
      </aside>

      {/* Sidebar (mobile) */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col overflow-y-auto bg-brand-900">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded p-2 text-white hover:bg-white/10"
                aria-label={t('nav.closeMenu')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        {me.demoMode && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 bg-amber-100 px-3 py-1 text-xs text-amber-950">
            <span>{t('app.demoBanner')}</span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              {t('app.simulatedToday', { date: formatDate(me.today) })}
            </span>
          </div>
        )}
        <div className="flex h-14 items-center gap-2 px-3 sm:px-6">
          <button
            type="button"
            className="rounded p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label={t('nav.openMenu')}
            aria-expanded={menuOpen}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 md:flex-none md:w-56 lg:w-64">
            <p className="truncate text-sm font-semibold text-slate-900">{me.name}</p>
            <p className="truncate text-xs text-slate-600">
              {t(`roles.${me.role}`)}
              {me.institutionName && ` · ${me.institutionName}`}
              {me.regionName && ` · ${me.regionName}`}
              {me.bankName && ` · ${me.bankName}`}
            </p>
          </div>
          <div className="flex flex-1 justify-center px-2">
            {(me.permissions.includes('instrument:read') ||
              me.permissions.includes('institution:read')) && <GlobalSearch />}
          </div>
          <NotificationBell />
          <LocaleSwitcher />
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{t('common.signOut')}</span>
          </button>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-3 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}

function Brand() {
  const t = useTranslations('app');
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-5 py-4 text-white">
      <ShieldCheck className="h-6 w-6" aria-hidden />
      <span>
        <span className="block font-bold leading-tight">{t('name')}</span>
        <span className="block text-xs text-brand-100/80">AICTE</span>
      </span>
    </Link>
  );
}
