'use client';

import { AlertTriangle, CheckCircle2, Clock, XOctagon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Chart tokens (dataviz reference palette, validated: series-1 passes on the white card surface). */
const SERIES_1 = '#2a78d6';
const GRID = '#e5e7eb';
const AXIS_TEXT = '#52514e';

export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

export interface BarDatum {
  label: string;
  value: number;
  /** Secondary text in the tooltip/table, e.g. a count next to an amount. */
  sub?: string;
}

export function ChartCard({
  title,
  description,
  table,
  children,
}: {
  title: string;
  description?: string;
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  const t = useTranslations('dashboard');
  return (
    <Card>
      <CardHeader title={title} description={description} as="h3" />
      <CardBody className="space-y-2">
        {children}
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-brand-700">
            {t('showTable')}
          </summary>
          <table className="mt-2 w-full text-xs">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left text-slate-600">
                {table.headers.map((h) => (
                  <th key={h} scope="col" className="py-1 pr-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {r.map((c, j) => (
                    <td key={j} className={cn('py-1 pr-2', j > 0 && 'tabular-nums')}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </CardBody>
    </Card>
  );
}

/** Single-series magnitude, sorted horizontal bars (one hue, no legend: the title names the series). */
export function HBarChart({ data, format }: { data: BarDatum[]; format: (v: number) => string }) {
  const height = Math.max(120, data.length * 34 + 30);
  return (
    <div
      style={{ height }}
      role="img"
      aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join('; ')}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 72, bottom: 4, left: 4 }}
          barCategoryGap={6}
        >
          <CartesianGrid horizontal={false} stroke={GRID} strokeWidth={1} />
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            tickLine={false}
            axisLine={false}
            tick={{ fill: AXIS_TEXT, fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(42,120,214,0.08)' }}
            formatter={(v, _n, item) => [
              `${format(Number(v))}${(item.payload as BarDatum).sub ? ` · ${(item.payload as BarDatum).sub}` : ''}`,
              '',
            ]}
            separator=""
            contentStyle={{ borderRadius: 6, borderColor: GRID, fontSize: 12 }}
          />
          <Bar
            dataKey="value"
            fill={SERIES_1}
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: unknown) => format(Number(v))}
              style={{ fill: '#0f172a', fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Part-to-whole of a state: one stacked bar in the reserved status colours, always with icon + label + count. */
export function StatusStack({
  parts,
}: {
  parts: { key: string; label: string; count: number; status: keyof typeof STATUS_COLORS }[];
}) {
  const total = parts.reduce((n, p) => n + p.count, 0);
  const ICON = {
    good: CheckCircle2,
    warning: Clock,
    serious: AlertTriangle,
    critical: XOctagon,
  } as const;
  return (
    <div className="space-y-3">
      <div
        className="flex h-5 w-full gap-[2px] overflow-hidden rounded"
        role="img"
        aria-label={parts.map((p) => `${p.label}: ${p.count}`).join('; ')}
      >
        {total === 0 ? (
          <div className="h-full w-full rounded bg-slate-100" />
        ) : (
          parts
            .filter((p) => p.count > 0)
            .map((p) => (
              <div
                key={p.key}
                title={`${p.label}: ${p.count}`}
                className="h-full first:rounded-l last:rounded-r"
                style={{
                  width: `${(p.count / total) * 100}%`,
                  background: STATUS_COLORS[p.status],
                  minWidth: 4,
                }}
              />
            ))
        )}
      </div>
      <ul className="grid grid-cols-2 gap-2 text-sm">
        {parts.map((p) => {
          const Icon = ICON[p.status];
          return (
            <li key={p.key} className="flex items-center gap-2">
              <Icon
                className="h-4 w-4 shrink-0"
                style={{ color: STATUS_COLORS[p.status] }}
                aria-hidden
              />
              <span className="text-slate-700">{p.label}</span>
              <span className="ml-auto font-semibold tabular-nums text-slate-900">{p.count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
