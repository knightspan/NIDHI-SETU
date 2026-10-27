'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Alert, Badge, Dialog, PageHeader, Spinner } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api-client';
import { can, useMe } from '@/lib/session';
import { formatDate, formatDateTime } from '@/lib/utils';

interface RuleRow {
  id: string;
  code: string;
  version: number;
  config: unknown;
  effectiveFrom: string;
  source: string;
  note: string | null;
  createdAt: string;
}
interface RuleView {
  code: string;
  type: string;
  current: RuleRow | null;
  scheduled: RuleRow[];
  history: RuleRow[];
}

/** Rule codes contain dots, which next-intl reads as nesting; message keys use underscores. */
function ruleName(t: ReturnType<typeof useTranslations<'rules'>>, code: string): string {
  const key = `names.${code.replace(/\./g, '_')}`;
  return t.has(key) ? t(key) : code;
}

export default function RulesPage() {
  const t = useTranslations('rules');
  const { data: me } = useMe();
  const { data, error } = useQuery({
    queryKey: ['rules'],
    queryFn: () => api<RuleView[]>('/api/rules'),
  });
  const [editing, setEditing] = useState<RuleView | null>(null);
  const [history, setHistory] = useState<RuleView | null>(null);
  const canEdit = can(me, 'rule:manage');

  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!data) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />
      {!canEdit && <Alert tone="info">{t('readOnly')}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((r) => (
          <Card key={r.code}>
            <CardHeader
              title={ruleName(t, r.code)}
              description={
                r.current
                  ? `${t('version', { version: r.current.version })} · ${t('effective', { date: formatDate(r.current.effectiveFrom) })}`
                  : undefined
              }
              actions={
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setHistory(r)}
                    aria-label={`${t('history')}: ${r.code}`}
                  >
                    <History className="h-4 w-4" aria-hidden />
                  </Button>
                  {canEdit && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                      {t('edit')}
                    </Button>
                  )}
                </>
              }
            />
            <CardBody className="space-y-2 text-sm">
              <code className="block text-xs text-slate-500">{r.code}</code>
              {r.current?.source.startsWith('ASSUMPTION') && (
                <Badge tone="amber">{t('assumption')}</Badge>
              )}
              <p className="text-xs text-slate-600">
                {t('source')}: {r.current?.source}
              </p>
              {r.current?.note && <p className="text-xs text-slate-600">{r.current.note}</p>}
              <pre
                tabIndex={0}
                className="max-h-56 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-800"
              >
                {JSON.stringify(r.current?.config, null, 2)}
              </pre>
              {r.scheduled.length > 0 && (
                <p className="text-xs text-blue-800">
                  {t('scheduled')}:{' '}
                  {r.scheduled
                    .map((s) => `v${s.version} (${formatDate(s.effectiveFrom)})`)
                    .join(', ')}
                </p>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
      <EditDialog rule={editing} onClose={() => setEditing(null)} />
      <Dialog
        open={!!history}
        onClose={() => setHistory(null)}
        title={`${t('history')}: ${history?.code ?? ''}`}
        wide
      >
        <ol className="space-y-3">
          {history?.history.map((h) => (
            <li key={h.id} className="rounded border border-slate-200 p-3 text-sm">
              <p className="font-semibold">
                {t('version', { version: h.version })} ·{' '}
                {t('effective', { date: formatDate(h.effectiveFrom) })}
              </p>
              <p className="text-xs text-slate-600">
                {t('source')}: {h.source} · {formatDateTime(h.createdAt)}
              </p>
              {h.note && <p className="text-xs text-slate-600">{h.note}</p>}
              <pre
                tabIndex={0}
                className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs"
              >
                {JSON.stringify(h.config, null, 2)}
              </pre>
            </li>
          ))}
        </ol>
      </Dialog>
    </div>
  );
}

function EditDialog({ rule, onClose }: { rule: RuleView | null; onClose: () => void }) {
  const t = useTranslations('rules');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const [json, setJson] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (rule && rule.code !== loadedFor) {
    setLoadedFor(rule.code);
    setJson(JSON.stringify(rule.current?.config ?? {}, null, 2));
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setSource('');
    setNote('');
    setError(null);
  }
  const publish = useMutation({
    mutationFn: (body: unknown) => api<{ version: number }>(`/api/rules/${rule!.code}`, { body }),
    onSuccess: async (r) => {
      toast.success(t('published', { version: r.version }));
      await qc.invalidateQueries({ queryKey: ['rules'] });
      setLoadedFor(null);
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = () => {
    let config: unknown;
    try {
      config = JSON.parse(json);
    } catch {
      setError(t('invalidJson'));
      return;
    }
    publish.mutate({ config, effectiveFrom, source, note: note || undefined });
  };
  return (
    <Dialog
      open={!!rule}
      onClose={() => {
        setLoadedFor(null);
        onClose();
      }}
      title={t('editTitle', { code: rule?.code ?? '' })}
      description={t('editHelp')}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={publish.isPending} disabled={source.trim().length < 3}>
            {t('publish')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('config')}>
          {(p) => (
            <Textarea
              {...p}
              rows={14}
              className="font-mono text-xs"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('effectiveFrom')} required>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('source')} required hint="e.g. AICTE APH 2024-27, clause …">
            {(p) => <Input {...p} value={source} onChange={(e) => setSource(e.target.value)} />}
          </Field>
        </div>
        <Field label={t('note')}>
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
