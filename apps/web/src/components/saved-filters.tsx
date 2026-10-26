'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Dialog } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';

interface SavedFilter {
  id: string;
  name: string;
  query: Record<string, string>;
}

/** Per-user saved filters for list pages (the filter lives in the URL). */
export function SavedFilters() {
  const t = useTranslations('savedFilters');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const { data } = useQuery({
    queryKey: ['saved-filters'],
    queryFn: () => api<SavedFilter[]>('/api/saved-filters'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['saved-filters'] });
  const save = useMutation({
    mutationFn: () => {
      const query: Record<string, string> = {};
      params.forEach((v, k) => k !== 'page' && (query[k] = v));
      return api('/api/saved-filters', { body: { name, query } });
    },
    onSuccess: async () => {
      toast.success(t('saved'));
      setNaming(false);
      setName('');
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/saved-filters/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success(t('deleted'));
      await refresh();
    },
  });
  const hasFilter = [...params.keys()].some((k) => k !== 'page');

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1 text-slate-600">
        <Bookmark className="h-4 w-4" aria-hidden />
        {t('title')}:
      </span>
      {data?.length === 0 && <span className="text-slate-500">{t('none')}</span>}
      {data?.map((f) => (
        <span
          key={f.id}
          className="inline-flex items-center rounded-full bg-brand-50 ring-1 ring-brand-600/20"
        >
          <button
            type="button"
            className="rounded-l-full px-3 py-1 text-brand-900 hover:bg-brand-100"
            onClick={() => router.replace(`${pathname}?${new URLSearchParams(f.query).toString()}`)}
          >
            {f.name}
          </button>
          <button
            type="button"
            className="rounded-r-full px-1.5 py-1 text-slate-500 hover:text-red-700"
            aria-label={`${tc('delete')}: ${f.name}`}
            onClick={() => remove.mutate(f.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {hasFilter && (
        <Button size="sm" variant="ghost" onClick={() => setNaming(true)}>
          <BookmarkPlus className="h-4 w-4" aria-hidden />
          {t('save')}
        </Button>
      )}
      <Dialog
        open={naming}
        onClose={() => setNaming(false)}
        title={t('save')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNaming(false)}>
              {tc('cancel')}
            </Button>
            <Button disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
              {tc('save')}
            </Button>
          </>
        }
      >
        <Field label={t('name')} required>
          {(p) => (
            <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          )}
        </Field>
      </Dialog>
    </div>
  );
}
