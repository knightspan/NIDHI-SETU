'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api-client';
import { can, useMe } from '@/lib/session';
import { useUrlState } from '@/lib/use-url-state';
import { formatDateTime } from '@/lib/utils';

interface AuditRow {
  seq: string;
  occurredAt: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  data: unknown;
  prevHash: string;
  hash: string;
}
interface VerifyResult {
  ok: boolean;
  checked: number;
  headHash: string;
  breaks: { seq: string; kind: string; expected: string; found: string }[];
}

export default function AuditPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const t = useTranslations('audit');
  const tc = useTranslations('common');
  const { data: me } = useMe();
  const [state, set] = useUrlState([
    'action',
    'entityType',
    'entityId',
    'from',
    'to',
    'page',
  ] as const);
  const [draft, setDraft] = useState({
    action: state.action ?? '',
    entityType: state.entityType ?? '',
    entityId: state.entityId ?? '',
    from: state.from ?? '',
    to: state.to ?? '',
  });
  const params = new URLSearchParams(
    Object.entries({ ...state, pageSize: '50' }).filter(([, v]) => v) as [string, string][],
  );
  const { data, isLoading } = useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () =>
      api<{ total: number; page: number; pageSize: number; items: AuditRow[] }>(
        `/api/audit/events?${params.toString()}`,
      ),
    placeholderData: keepPreviousData,
  });
  const verify = useMutation({
    mutationFn: () => api<VerifyResult>('/api/audit/verify', { method: 'POST' }),
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          can(me, 'audit:verify') && (
            <Button onClick={() => verify.mutate()} loading={verify.isPending}>
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {t('verify')}
            </Button>
          )
        }
      />
      {verify.isPending && <Alert tone="info">{t('verifying')}</Alert>}
      {verify.error && <Alert tone="error">{errorMessage(verify.error)}</Alert>}
      {verify.data &&
        (verify.data.ok ? (
          <Alert tone="success" title={t('ok', { count: verify.data.checked })}>
            <span className="font-mono text-xs break-all">
              {t('head')}: {verify.data.headHash}
            </span>
          </Alert>
        ) : (
          <Alert tone="error" title={t('broken', { count: verify.data.breaks.length })}>
            <ul className="mt-1 space-y-1">
              {verify.data.breaks.slice(0, 10).map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    #{b.seq} · {b.kind} ·{' '}
                    <span className="font-mono">
                      {b.found.slice(0, 16)}… ≠ {b.expected.slice(0, 16)}…
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        ))}

      <Card>
        <CardBody className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              set(draft);
            }}
          >
            <Field label={t('filterAction')} className="sm:col-span-2">
              {(p) => (
                <Input
                  {...p}
                  placeholder="instrument."
                  value={draft.action}
                  onChange={(e) => setDraft({ ...draft, action: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('filterEntity')}>
              {(p) => (
                <Input
                  {...p}
                  value={draft.entityType}
                  onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('from')}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('to')}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              )}
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full">
                {tc('filter')}
              </Button>
            </div>
          </form>
          {isLoading || !data ? (
            <Skeleton className="h-60" />
          ) : data.items.length === 0 ? (
            <EmptyState title={t('empty')} />
          ) : (
            <>
              <Table caption={t('title')}>
                <THead>
                  <tr>
                    <TH>{t('colSeq')}</TH>
                    <TH>{t('colWhen')}</TH>
                    <TH>{t('colActor')}</TH>
                    <TH>{t('colAction')}</TH>
                    <TH>{t('colEntity')}</TH>
                    <TH>{t('colHash')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.items.map((r) => (
                    <TR key={r.seq}>
                      <TD className="tabular-nums">{r.seq}</TD>
                      <TD className="whitespace-nowrap text-xs">{formatDateTime(r.occurredAt)}</TD>
                      <TD className="text-xs">
                        {r.actorRole ?? '—'}
                        {r.actorId && (
                          <div className="font-mono text-[10px] text-slate-500">
                            {r.actorId.slice(0, 8)}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <code className="text-xs">{r.action}</code>
                        <details className="text-xs">
                          <summary className="cursor-pointer text-brand-700">
                            {t('details')}
                          </summary>
                          <pre
                            tabIndex={0}
                            className="mt-1 max-w-md overflow-auto rounded bg-slate-50 p-2 text-[11px]"
                          >
                            {JSON.stringify(r.data, null, 2)}
                          </pre>
                        </details>
                      </TD>
                      <TD className="text-xs">
                        {r.entityType}
                        {r.entityId && (
                          <button
                            type="button"
                            className="block font-mono text-[10px] text-brand-700 hover:underline"
                            onClick={() => set({ entityId: r.entityId! })}
                          >
                            {r.entityId.slice(0, 13)}
                          </button>
                        )}
                      </TD>
                      <TD
                        className="font-mono text-[11px] text-slate-600"
                        title={`prev ${r.prevHash}\nhash ${r.hash}`}
                      >
                        {r.hash.slice(0, 12)}…
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={data.page <= 1}
                  onClick={() => set({ page: String(data.page - 1) }, false)}
                >
                  {tc('previous')}
                </Button>
                <span className="text-sm text-slate-600">
                  {tc('page', { page: data.page, pages })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={data.page >= pages}
                  onClick={() => set({ page: String(data.page + 1) }, false)}
                >
                  {tc('next')}
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
