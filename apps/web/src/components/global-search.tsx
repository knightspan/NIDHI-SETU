'use client';

import type { InstrumentSummary } from '@nidhisetu/shared';
import { useQuery } from '@tanstack/react-query';
import { Building2, FileStack, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { StatusBadge } from '@/components/badges';
import { api } from '@/lib/api-client';

interface Results {
  institutions: { id: string; name: string; aicteId: string; region: { name: string } }[];
  instruments: InstrumentSummary[];
}

/** Header search across institutions and instruments (scoped by the API). */
export function GlobalSearch() {
  const t = useTranslations('search');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => {
    setOpen(false);
    setQ('');
  }, [pathname]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) =>
      box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const { data } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<Results>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });
  const show = open && debounced.length >= 2 && !!data;
  const empty = data && data.institutions.length === 0 && data.instruments.length === 0;

  return (
    <div ref={box} className="relative w-full">
      <Search
        className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-[var(--dp-color-on-field-muted)]"
        aria-hidden
      />
      <input
        type="search"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-label={t('label')}
        placeholder={t('placeholder')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="dp-search"
      />
      {show && (
        <div id={listId} className="dp-panel dp-results">
          {empty && <p className="p-2 text-sm text-slate-600">{t('none')}</p>}
          {data.institutions.length > 0 && (
            <section>
              <h3 className="dp-engrave px-2 pt-1">{t('institutions')}</h3>
              <ul>
                {data.institutions.map((i) => (
                  <li key={i.id}>
                    <Link href={`/institutions/${i.id}`} className="dp-result">
                      <Building2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <span className="truncate">{i.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-slate-500">{i.aicteId}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.instruments.length > 0 && (
            <section>
              <h3 className="dp-engrave px-2 pt-2">{t('instruments')}</h3>
              <ul>
                {data.instruments.map((i) => (
                  <li key={i.id}>
                    <Link href={`/instruments/${i.id}`} className="dp-result">
                      <FileStack className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <span className="font-medium">{i.refNo}</span>
                      <span className="truncate text-xs text-slate-500">
                        {i.fdrNumber} · {i.institution.name}
                      </span>
                      <span className="ml-auto shrink-0">
                        <StatusBadge status={i.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
