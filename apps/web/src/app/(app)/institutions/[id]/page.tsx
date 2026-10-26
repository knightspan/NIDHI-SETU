'use client';

import type { InstitutionStatementView } from '@nidhisetu/shared';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { StatusBadge, TrustScore, ValidityBadge } from '@/components/badges';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Badge, PageHeader, Spinner } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api-client';
import { can, useMe } from '@/lib/session';
import { formatDate, formatInr } from '@/lib/utils';
import Link from 'next/link';
import { ComplianceBadge } from '@/components/compliance-badge';

export default function InstitutionPage() {
  const t = useTranslations();
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const { data: s, error } = useQuery({
    queryKey: ['institution', id],
    queryFn: () => api<InstitutionStatementView>(`/api/institutions/${id}`),
  });
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!s) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader
        title={s.name}
        description={`${s.aicteId} · ${s.trustName} · ${s.state} · ${s.regionName}`}
        actions={
          can(me, 'report:read') && (
            <a
              href={`/api/reports/institution-statement?format=pdf&institutionId=${s.id}`}
              className={buttonVariants({ variant: 'secondary' })}
            >
              <Download className="h-4 w-4" aria-hidden />
              {t('institutions.downloadPdf')}
            </a>
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-600">{t('institutions.colHeld')}</p>
            <p className="text-2xl font-bold tabular-nums">{formatInr(s.heldAmount)}</p>
            <p className="text-xs text-slate-500">
              {t('dashboard.kpi.heldCount', { count: s.heldCount })}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-600">{t('institutions.colRequired')}</p>
            <p className="text-2xl font-bold tabular-nums">
              {s.exempt ? '—' : formatInr(s.required)}
            </p>
            <p className="text-xs text-slate-500">{t('institutions.requirementNote')}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1">
            <p className="text-xs font-medium text-slate-600">{t('institutions.colStatus')}</p>
            <ComplianceBadge i={s} />
            <p className="text-xs text-slate-600">
              {t('instruments.established', { year: s.yearEstablished })}
            </p>
            <div className="flex flex-wrap gap-1">
              {s.programmes.map((p) => (
                <Badge key={p} tone="slate">
                  {p.replaceAll('_', ' ').toLowerCase()}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader
          title={t('institutions.statement')}
          description={`${t('institutions.contact')}: ${s.contactEmail} · ${s.contactPhone}`}
        />
        <CardBody className="p-0 sm:p-0">
          <Table caption={t('institutions.statement')}>
            <THead>
              <tr>
                <TH>{t('instruments.colRef')}</TH>
                <TH>{t('instruments.colBank')}</TH>
                <TH className="text-right">{t('instruments.colAmount')}</TH>
                <TH>{t('instruments.colMaturity')}</TH>
                <TH>{t('instruments.colStatus')}</TH>
                <TH>{t('instruments.colValidity')}</TH>
                <TH>{t('instruments.colTrust')}</TH>
              </tr>
            </THead>
            <TBody>
              {s.instruments.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <Link
                      href={`/instruments/${i.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {i.refNo}
                    </Link>
                    <div className="font-mono text-xs text-slate-500">{i.fdrNumber}</div>
                  </TD>
                  <TD>{i.bankName ?? i.bankCode}</TD>
                  <TD className="text-right tabular-nums">{formatInr(i.amount)}</TD>
                  <TD>{formatDate(i.maturityDate)}</TD>
                  <TD>
                    <StatusBadge status={i.status} />
                  </TD>
                  <TD>
                    <ValidityBadge validity={i.validityStatus} />
                  </TD>
                  <TD>
                    <TrustScore score={i.trustScore} compact />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
