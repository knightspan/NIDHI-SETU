'use client';

import { CalendarClock, LogOut, Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Spinner } from '@/components/ui/misc';
import { ApiError } from '@/lib/api-client';
import { visibleNav, type NavItem } from '@/lib/nav';
import { useMe, useSignOut } from '@/lib/session';
import { formatDate } from '@/lib/utils';
import { GlobalSearch } from './global-search';
import { NotificationBell } from './notification-bell';

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { data: me, error, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const signOut = useSignOut();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [error, router, pathname]);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1101px)');
    const onChange = () => {
      if (mq.matches) setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // A temporary password must be replaced before anything else (the API enforces this too).
  useEffect(() => {
    if (me?.mustChangePassword && pathname !== '/account') router.replace('/account');
  }, [me?.mustChangePassword, pathname, router]);

  if (isLoading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }

  const items = visibleNav(me);
  const isActive = (href: string) =>
    href === '/instruments'
      ? pathname === href || /^\/instruments\/(?!new)/.test(pathname)
      : pathname === href || pathname.startsWith(`${href}/`);

  const canSearch =
    me.permissions.includes('instrument:read') || me.permissions.includes('institution:read');
  const place = me.institutionName || me.regionName || me.bankName || undefined;

  return (
    <div className="dp-app">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 dp-util"
      >
        {t('app.skipToContent')}
      </a>

      <div className="dp-case dp-housing" inert={menuOpen ? true : undefined}>
        <aside className="dp-rail">
          <RailBody
            meName={me.name}
            role={t(`roles.${me.role}`)}
            place={place}
            items={items}
            isActive={isActive}
          />
        </aside>
        <div className="dp-seam" aria-hidden />
        <div className="dp-stage">
          {me.demoMode && (
            <div className="dp-demo" role="status">
              <span className="dp-lamp dp-lamp-on" aria-hidden />
              <span>{t('app.demoBanner')}</span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                {t('app.simulatedToday', { date: formatDate(me.today) })}
              </span>
            </div>
          )}
          <header className="dp-top">
            <button
              type="button"
              className="dp-util dp-press dp-menu-btn"
              onClick={() => setMenuOpen(true)}
              aria-label={t('nav.openMenu')}
              aria-expanded={menuOpen}
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <Link href="/account" className="dp-who">
              <span className="dp-who-name">{me.name}</span>
              <span className="dp-who-role">
                {t(`roles.${me.role}`)}
                {place ? ` · ${place}` : ''}
              </span>
            </Link>
            {canSearch && (
              <div className="dp-searchwrap">
                <GlobalSearch />
              </div>
            )}
            <div className="dp-utils">
              <NotificationBell />
              <LocaleSwitcher />
              <button
                type="button"
                onClick={() => void signOut()}
                className="dp-util dp-press"
                aria-label={t('common.signOut')}
              >
                <LogOut className="h-4 w-4" aria-hidden />
                <span className="dp-show-760">{t('common.signOut')}</span>
              </button>
            </div>
          </header>
          <div className="dp-content">
            <main id="main">{children}</main>
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="dp-scrim" onClick={() => setMenuOpen(false)}>
          <aside
            className="dp-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.main')}
            onClick={(e) => e.stopPropagation()}
          >
            <RailBody
              meName={me.name}
              role={t(`roles.${me.role}`)}
              place={place}
              items={items}
              isActive={isActive}
              onNavigate={() => setMenuOpen(false)}
              closeRef={closeRef}
              onClose={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function RailBody({
  meName,
  role,
  place,
  items,
  isActive,
  onNavigate,
  closeRef,
  onClose,
}: {
  meName: string;
  role: string;
  place?: string;
  items: NavItem[];
  isActive: (href: string) => boolean;
  onNavigate?: () => void;
  closeRef?: RefObject<HTMLButtonElement | null>;
  onClose?: () => void;
}) {
  const t = useTranslations();
  const sections: { id: 'work' | 'oversight' | 'admin'; label?: string }[] = [
    { id: 'work' },
    { id: 'oversight', label: t('nav.sectionOversight') },
    { id: 'admin', label: t('nav.sectionAdmin') },
  ];
  const groups = sections
    .map((s) => ({ ...s, list: items.filter((i) => i.section === s.id) }))
    .filter((s) => s.list.length > 0);
  let n = 0;

  return (
    <>
      <div className="flex items-start gap-2">
        <Link href="/dashboard" className="dp-brand min-w-0 flex-1" onClick={onNavigate}>
          <span className="dp-brand-tools">
            <span className="dp-vents" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <span className="flex gap-2" aria-hidden>
              <i className="dp-screw" />
              <i className="dp-screw" />
            </span>
          </span>
          <span className="dp-brand-name">{t('app.name')}</span>
          <span className="dp-meta">{t('app.org')}</span>
        </Link>
        {onClose && (
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="dp-util dp-press h-10 w-10 shrink-0"
            aria-label={t('nav.closeMenu')}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>

      <nav aria-label={t('nav.main')} className="dp-keybank">
        {groups.map((s, bay) => (
          <div key={s.id} className="dp-bay">
            <p className="dp-bayhead">
              <span className="dp-engrave">{String(bay + 1).padStart(2, '0')}</span>
              {s.label && <span className="dp-engrave">{s.label}</span>}
              <span className="dp-bayrule" aria-hidden />
            </p>
            <ul className="flex flex-col gap-1.5">
              {s.list.map((item) => {
                n += 1;
                const index = String(n).padStart(2, '0');
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      className="dp-navkey dp-press"
                      onClick={onNavigate}
                    >
                      <span className="dp-navindex">{index}</span>
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="dp-navlabel">{t(`nav.${item.key}`)}</span>
                      <span className="dp-lamp" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <Link href="/account" className="dp-idplate" onClick={onNavigate}>
        <span className="dp-engrave">{role}</span>
        <span className="dp-idname">{meName}</span>
        {place && <span className="dp-meta truncate">{place}</span>}
      </Link>
    </>
  );
}
