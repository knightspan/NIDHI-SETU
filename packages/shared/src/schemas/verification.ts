import { z } from 'zod';
import type {
  Compounding,
  ForfeitureStatus,
  RiskLevel,
  SignalEye,
  SignalResult,
  TrustTier,
} from '../enums.js';
import { isoDate } from '../fields.js';

// ─── TRINETRA signals ───────────────────────────────────────────────────────

export interface SignalView {
  id: string;
  eye: SignalEye;
  result: SignalResult;
  /** Financial year for tax-eye signals, e.g. "2025-26". */
  fy: string | null;
  details: Record<string, unknown>;
  evidenceDocumentId: string | null;
  checkedAt: string;
  validUntil: string | null;
}

/** The current state of one eye, as shown on the instrument page. */
export interface EyeSummary {
  eye: SignalEye;
  /** Effective result now (a PASS past its validity reads as STALE). */
  result: SignalResult;
  latest: SignalView | null;
}

/** One cell of the annual heartbeat strip (tax eye per financial year). */
export interface HeartbeatCell {
  fy: string;
  result: SignalResult;
  expected: number | null;
  reported: number | null;
}

export interface GateFailure {
  code: 'NO_FRESH_BANK_PASS' | 'OPEN_HIGH_DISCREPANCY' | 'TAX_HEARTBEAT_FAILED';
  message: string;
}

export interface InstrumentVerificationView {
  eyes: EyeSummary[];
  heartbeat: HeartbeatCell[];
  riskLevel: RiskLevel;
  riskScore: number;
  trustTier: TrustTier;
  /** Release and renewal are locked after a tax FAIL until the bank re-attests. */
  taxLocked: boolean;
  terms: {
    interestRate: string | null;
    maturityValue: string | null;
    compounding: Compounding;
  };
  /** Result of the re-verification gate if an approval were attempted now. */
  gate: { passed: boolean; failures: GateFailure[] };
}

// ─── Forfeiture ─────────────────────────────────────────────────────────────

export const ForfeitureProposeSchema = z.object({
  reason: z.string().trim().min(10, 'Explain why the deposit should be forfeited').max(2000),
  /** Show-cause / order number the proposal relies on. */
  orderReference: z.string().trim().min(3, 'Order reference is required').max(100),
});
export type ForfeitureProposeInput = z.infer<typeof ForfeitureProposeSchema>;

export const ForfeitureExecuteSchema = z.object({
  executionRef: z.string().trim().min(3).max(100),
  executionDate: isoDate,
  note: z.string().trim().max(2000).optional(),
});
export type ForfeitureExecuteInput = z.infer<typeof ForfeitureExecuteSchema>;

export interface ForfeitureView {
  id: string;
  instrumentId: string;
  refNo: string;
  institutionName: string;
  amount: string | null;
  status: ForfeitureStatus;
  reason: string;
  orderReference: string;
  proposedBy: string | null;
  proposedById: string;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedBy: string | null;
  executedAt: string | null;
  executionRef: string | null;
  executionDate: string | null;
}

// ─── Tax heartbeat (AIS) ────────────────────────────────────────────────────

export const FY_REGEX = /^\d{4}-\d{2}$/;

export interface AisStatementView {
  id: string;
  fy: string;
  parser: string;
  /** Interest from deposits reported per bank (₹), keyed by bank code. */
  interestByBank: Record<string, number>;
  /** Reporting sources that could not be matched to a bank in the master. */
  unmatched: { source: string; amount: number }[];
  uploadedAt: string;
}

export interface AisRequestView {
  id: string;
  fy: string;
  requestedAt: string;
  dueAt: string;
  fulfilledAt: string | null;
}

// ─── Metrics: manual effort ─────────────────────────────────────────────────

export const RegistersRetiredSchema = z.object({
  retired: z.number().int().nonnegative(),
  total: z.number().int().positive().optional(),
  note: z.string().trim().max(500).optional(),
});
export type RegistersRetiredInput = z.infer<typeof RegistersRetiredSchema>;
