'use client';

import { ROLES, ROLE_SCOPE, type Role } from '@nidhisetu/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Alert, Badge, Dialog, PageHeader, Spinner } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api-client';
import { useBanks, useRegions } from '@/lib/master-data';
import { formatDateTime } from '@/lib/utils';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  region: { name: string } | null;
  institution: { name: string } | null;
  bank: { name: string } | null;
}

export default function UsersPage() {
  const t = useTranslations();
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api<UserRow[]>('/api/admin/users'),
  });
  const [creating, setCreating] = useState(false);
  const [temporary, setTemporary] = useState<{ email: string; password: string } | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const resetPassword = useMutation({
    mutationFn: (u: UserRow) =>
      api<{ temporaryPassword: string }>(`/api/admin/users/${u.id}/reset-password`, {
        method: 'POST',
        body: {},
      }).then((r) => ({ email: u.email, password: r.temporaryPassword })),
    onSuccess: (r) => {
      setResetting(null);
      setTemporary(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const act = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: 'POST' | 'PATCH';
      body?: unknown;
      ok: string;
    }) => api(path, { method, body: body ?? {} }),
    onSuccess: async (_d, v) => {
      toast.success(v.ok);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!data) return <Spinner />;

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {t('users.new')}
          </Button>
        }
      />
      <Card>
        <CardBody className="p-0 sm:p-0">
          <Table caption={t('users.title')}>
            <THead>
              <tr>
                <TH>{t('users.name')}</TH>
                <TH>{t('users.role')}</TH>
                <TH>{t('users.scope')}</TH>
                <TH>{t('users.mfa')}</TH>
                <TH>{t('users.lastLogin')}</TH>
                <TH>{t('common.actions')}</TH>
              </tr>
            </THead>
            <TBody>
              {data.map((u) => (
                <TR key={u.id} className={u.active ? undefined : 'opacity-60'}>
                  <TD>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </TD>
                  <TD>{t(`roles.${u.role}`)}</TD>
                  <TD className="max-w-56 truncate text-sm">
                    {u.region?.name ?? u.institution?.name ?? u.bank?.name ?? '—'}
                  </TD>
                  <TD>
                    {u.mfaEnabled ? (
                      <Badge tone="green">
                        <ShieldCheck className="h-3 w-3" aria-hidden /> TOTP
                      </Badge>
                    ) : (
                      <Badge tone="slate">
                        <ShieldOff className="h-3 w-3" aria-hidden /> —
                      </Badge>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-xs">{formatDateTime(u.lastLoginAt)}</TD>
                  <TD className="space-x-1 whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        act.mutate({
                          path: `/api/admin/users/${u.id}`,
                          method: 'PATCH',
                          body: { active: !u.active },
                          ok: t('users.updated'),
                        })
                      }
                    >
                      {u.active ? t('users.deactivate') : t('users.activate')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                      {t('users.resetPassword')}
                    </Button>
                    {u.mfaEnabled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act.mutate({
                            path: `/api/admin/users/${u.id}/reset-mfa`,
                            method: 'POST',
                            ok: t('users.mfaReset'),
                          })
                        }
                      >
                        {t('users.resetMfa')}
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>
      <CreateDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title={t('users.resetPassword')}
        description={resetting ? t('users.resetPasswordConfirm', { email: resetting.email }) : ''}
        confirmLabel={t('users.resetPassword')}
        variant="danger"
        loading={resetPassword.isPending}
        onConfirm={() => resetting && resetPassword.mutate(resetting)}
      />
      <Dialog
        open={temporary !== null}
        onClose={() => setTemporary(null)}
        title={t('users.temporaryTitle')}
        description={temporary ? t('users.temporaryBody', { email: temporary.email }) : ''}
        footer={<Button onClick={() => setTemporary(null)}>{t('common.close')}</Button>}
      >
        <p className="rounded-md bg-slate-100 p-3 text-center font-mono text-lg tracking-wide break-all text-slate-900">
          {temporary?.password}
        </p>
      </Dialog>
    </>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations();
  const qc = useQueryClient();
  const { regions } = useRegions();
  const { banks } = useBanks();
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'RO_OFFICER' as Role,
    password: '',
    regionId: '',
    bankId: '',
    institutionId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const scope = ROLE_SCOPE[form.role];
  const create = useMutation({
    mutationFn: () =>
      api('/api/admin/users', {
        body: {
          name: form.name,
          email: form.email,
          role: form.role,
          password: form.password,
          regionId: scope === 'REGION' ? form.regionId : undefined,
          bankId: scope === 'BANK' ? form.bankId : undefined,
          institutionId: scope === 'INSTITUTION' ? form.institutionId : undefined,
        },
      }),
    onSuccess: async () => {
      toast.success(t('users.created'));
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('users.new')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('users.name')} required>
          {(p) => <Input {...p} value={form.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>
        <Field label={t('users.email')} required>
          {(p) => (
            <Input
              {...p}
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          )}
        </Field>
        <Field label={t('users.role')} required>
          {(p) => (
            <Select {...p} value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {scope === 'REGION' && (
          <Field label={t('users.region')} required>
            {(p) => (
              <Select
                {...p}
                value={form.regionId}
                onChange={(e) => set('regionId', e.target.value)}
              >
                <option value="" />
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {scope === 'BANK' && (
          <Field label={t('users.bank')} required>
            {(p) => (
              <Select {...p} value={form.bankId} onChange={(e) => set('bankId', e.target.value)}>
                <option value="" />
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {scope === 'INSTITUTION' && (
          <Field label={t('users.institutionId')} required hint="Institution ID (UUID)">
            {(p) => (
              <Input
                {...p}
                value={form.institutionId}
                onChange={(e) => set('institutionId', e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label={t('users.password')} required hint={t('users.passwordHint')}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
