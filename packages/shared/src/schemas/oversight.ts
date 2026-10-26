import { z } from 'zod';
import type { LifecycleStatus, ValidityStatus } from '../enums.js';
import type { InstrumentSummary } from './instrument.js';

export interface DashboardKpis {
  heldCount: number;
  heldAmount: string;
  active: number;
  expiring30: number;
  expiring60: number;
  expiring90: number;
  matured: number;
  overdue: number;
  renewed: number;
  released: number;
  pendingVerification: number;
  openDiscrepancies: number;
  fraudSignals: number;
}

/** Work-queue entry: label key under `dashboard.queue.*` in the web app. */
export interface QueueItem {
  key: string;
  count: number;
  href: string;
  urgent?: boolean;
}

export interface DashboardData {
  today: string;
  scope: 'INSTITUTION' | 'REGION' | 'BANK' | 'NATIONAL' | 'NONE';
  kpis: DashboardKpis;
  byStatus: { status: LifecycleStatus; count: number }[];
  byValidity: { validity: ValidityStatus; count: number }[];
  byRegion: { regionId: string; name: string; count: number; amount: string }[];
  byBank: { code: string; name: string; count: number; amount: string }[];
  queue: QueueItem[];
  generatedInMs: number;
}

export interface InstitutionSummaryView {
  id: string;
  aicteId: string;
  name: string;
  trustName: string;
  regionName: string;
  state: string;
  yearEstablished: number;
  programmes: string[];
  heldCount: number;
  heldAmount: string;
  required: string;
  exempt: boolean;
  compliant: boolean;
  openDiscrepancies: number;
}

export interface InstitutionStatementView extends InstitutionSummaryView {
  contactEmail: string;
  contactPhone: string;
  instruments: InstrumentSummary[];
}

export const InstitutionListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  regionId: z.uuid().optional(),
  compliance: z.enum(['compliant', 'shortfall', 'exempt']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type InstitutionListQuery = z.infer<typeof InstitutionListQuerySchema>;

export const REPORT_TYPES = [
  'pending-verifications',
  'upcoming-maturities',
  'missing-documents',
  'intervention',
  'institution-statement',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const ReportQuerySchema = z.object({
  format: z.enum(REPORT_FORMATS).default('csv'),
  days: z.coerce.number().int().min(1).max(3650).default(90),
  institutionId: z.uuid().optional(),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const METRIC_KEYS = [
  'verification_turnaround_days',
  'renewals_before_maturity_pct',
  'release_processing_days',
  'open_discrepancy_age_days',
  'fully_bank_confirmed_pct',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface MetricView {
  key: MetricKey;
  unit: 'days' | 'percent';
  betterWhen: 'lower' | 'higher';
  value: number | null;
  sampleSize: number;
  baseline: number | null;
  baselineNote: string | null;
  /** Optional breakdown, e.g. discrepancy ageing buckets. */
  buckets?: { label: string; count: number }[];
}

export const MetricBaselineSchema = z.object({
  value: z.number().min(0).max(100_000),
  note: z.string().trim().max(500).optional(),
});
export type MetricBaselineInput = z.infer<typeof MetricBaselineSchema>;

export const SavedFilterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.record(z.string(), z.string()),
});
export type SavedFilterInput = z.infer<typeof SavedFilterSchema>;
