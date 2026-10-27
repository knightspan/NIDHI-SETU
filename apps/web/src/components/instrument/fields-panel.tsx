'use client';

import type { FieldView, InstrumentDetail } from '@nidhisetu/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useState, type ReactNode } from 'react';
import { TrustBadge, TrustLegend } from '@/components/badges';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatFieldValue } from '@/lib/format-field';
import { useBanks } from '@/lib/master-data';
import { formatDateTime } from '@/lib/utils';

/**
 * The provenance view (Section 3.1): every key field with its effective value, trust badge and the
 * full assertion history. `renderAction` lets the scrutiny workspace add a per-field verify button.
 */
export function FieldsPanel({
  inst,
  renderAction,
}: {
  inst: InstrumentDetail;
  renderAction?: (f: FieldView) => ReactNode;
}) {
  const t = useTranslations();
  const { bankName } = useBanks();
  const [open, setOpen] = useState<string | null>(null);
  const fmt = (f: FieldView, v: string | null) =>
    formatFieldValue(f.field, v, { bankName, yes: t('common.yes'), no: t('common.no') });

  return (
    <Card>
      <CardHeader
        title={t('instruments.fieldsTitle')}
        description={t('instruments.fieldsDescription')}
      />
      <CardBody className="space-y-3 p-0 sm:p-0">
        <div className="px-4 pt-3">
          <TrustLegend />
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('instruments.fieldsTitle')}</caption>
            <thead className="bg-slate-50 text-left text-xs text-slate-600 uppercase">
              <tr>
                <th scope="col" className="w-8 px-2 py-2">
                  <span className="sr-only">{t('instruments.history')}</span>
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('instruments.colField')}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('instruments.colValue')}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('instruments.colSource')}
                </th>
                {renderAction && (
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inst.fields.map((f) => {
                const isOpen = open === f.field;
                return (
                  <Fragment key={f.field}>
                    <tr className={f.mismatch ? 'bg-red-50/60' : undefined} data-field={f.field}>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          className="rounded p-1 text-slate-500 hover:bg-slate-100"
                          aria-expanded={isOpen}
                          aria-label={`${t('instruments.history')}: ${t(`fields.${f.field}`)}`}
                          onClick={() => setOpen(isOpen ? null : f.field)}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700">
                        {t(`fields.${f.field}`)}
                      </th>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {fmt(f, f.effectiveValue)}
                      </td>
                      <td className="px-3 py-2">
                        <TrustBadge level={f.effectiveTrust} mismatch={f.mismatch} />
                      </td>
                      {renderAction && <td className="px-3 py-2 text-right">{renderAction(f)}</td>}
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70">
                        <td />
                        <td colSpan={renderAction ? 4 : 3} className="px-3 py-2">
                          <ul className="space-y-1.5">
                            {f.history.map((h) => (
                              <li
                                key={h.id}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                              >
                                <TrustBadge level={h.trust} />
                                <span className="font-semibold text-slate-900">
                                  {fmt(f, h.value)}
                                </span>
                                <span className="text-slate-600">
                                  {t('instruments.assertedBy', {
                                    source: h.source ?? '—',
                                    who: h.actorName ?? t('roles.SYSTEM'),
                                    when: formatDateTime(h.createdAt),
                                  })}
                                  {h.confidence !== null &&
                                    ` · ${t('instruments.confidence', { value: Math.round(h.confidence * 100) })}`}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
