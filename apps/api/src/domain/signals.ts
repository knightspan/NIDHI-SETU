import {
  FIELD_KEYS,
  type FieldKey,
  type GateFailure,
  type RiskLevel,
  type RiskWeightsRule,
  type SignalEye,
  type SignalResult,
  type TrustTier,
  type TrustWeightsRule,
} from '@nidhisetu/shared';
import { isFullyBankConfirmed, TRUST_RANK, type FieldState } from './trust.js';

const DAY_MS = 86_400_000;
const MONTH_MS = 30.4375 * DAY_MS;

export interface SignalLike {
  result: SignalResult;
  checkedAt: Date;
  validUntil: Date | null;
}

/** A PASS that has outlived its validity reads as STALE; no signal at all is NOT_AVAILABLE. */
export function effectiveResult(latest: SignalLike | null, now: Date): SignalResult {
  if (!latest) return 'NOT_AVAILABLE';
  if (latest.result === 'PASS' && latest.validUntil && latest.validUntil < now) return 'STALE';
  return latest.result;
}

/**
 * Trust score 0–100 (addendum §2): weighted blend of field provenance and the three eyes. Each eye
 * earns `credit[result]` of its weight, decayed linearly with the signal's age down to minAgeFactor.
 */
export function computeTrustScore(
  provenance: number,
  eyes: Record<SignalEye, SignalLike | null>,
  rule: TrustWeightsRule,
  now: Date,
): number {
  const w = rule.weights;
  const total = w.provenance + w.bank + w.tax + w.document;
  if (total <= 0) return 0;
  let score = (provenance / 100) * w.provenance;
  for (const eye of ['BANK', 'TAX', 'DOCUMENT'] as const) {
    const s = eyes[eye];
    const result = effectiveResult(s, now);
    let factor = 1;
    if (s && result !== 'NOT_AVAILABLE') {
      const ageMonths = Math.max(0, (now.getTime() - s.checkedAt.getTime()) / MONTH_MS);
      factor = Math.max(
        rule.minAgeFactor,
        1 - ((1 - rule.minAgeFactor) * ageMonths) / rule.ageDecayMonths,
      );
    }
    score += rule.credit[result] * factor * w[eye.toLowerCase() as 'bank' | 'tax' | 'document'];
  }
  return Math.round((score / total) * 100);
}

/** How far the key fields are evidenced, for the dashboard's trust mix. */
export function trustTierOf(states: Record<FieldKey, FieldState>): TrustTier {
  if (isFullyBankConfirmed(states)) return 'BANK_CONFIRMED';
  const officer = TRUST_RANK.OFFICER_VERIFIED;
  const allVerified = FIELD_KEYS.every((f) => {
    const t = states[f].effectiveTrust;
    return !!t && TRUST_RANK[t] >= officer && !states[f].mismatch;
  });
  return allVerified ? 'OFFICER_VERIFIED' : 'UNVERIFIED';
}

export interface RiskInput {
  trustScore: number;
  openHighDiscrepancies: number;
  failedSignals: number;
  /** null when the maturity date is unknown. */
  daysToMaturity: number | null;
}

/** Risk points and level from the weights in the rules table. */
export function computeRisk(
  i: RiskInput,
  rule: RiskWeightsRule,
): { score: number; level: RiskLevel } {
  let points = (rule.lowTrust * (100 - Math.min(100, Math.max(0, i.trustScore)))) / 100;
  points += rule.openHighDiscrepancy * Math.min(3, i.openHighDiscrepancies);
  points += rule.failedSignal * i.failedSignals;
  if (i.daysToMaturity !== null) {
    if (i.daysToMaturity < 0) points += rule.matured;
    else if (i.daysToMaturity <= rule.nearMaturityDays) points += rule.nearMaturity;
  }
  const score = Math.round(points * 10) / 10;
  return {
    score,
    level: score >= rule.highAt ? 'HIGH' : score >= rule.mediumAt ? 'MEDIUM' : 'LOW',
  };
}

export interface GateInput {
  /** Time of the latest bank PASS (any purpose), or null. */
  latestBankPassAt: Date | null;
  openHighDiscrepancies: number;
  /** Tax-eye result for the latest financial year that has one, or null. */
  latestTaxResult: SignalResult | null;
  now: Date;
  maxBankPassAgeDays: number;
}

/**
 * Re-verification gate for RELEASE_RECOMMENDED → RELEASE_APPROVED and FORFEITURE_PROPOSED →
 * FORFEITURE_APPROVED (addendum §3): a fresh bank PASS, no open HIGH discrepancy, tax not FAIL.
 */
export function evaluateReverificationGate(i: GateInput): {
  passed: boolean;
  failures: GateFailure[];
} {
  const failures: GateFailure[] = [];
  const maxAge = i.maxBankPassAgeDays * DAY_MS;
  if (!i.latestBankPassAt || i.now.getTime() - i.latestBankPassAt.getTime() > maxAge) {
    failures.push({
      code: 'NO_FRESH_BANK_PASS',
      message: `The bank has not re-confirmed this deposit in the last ${i.maxBankPassAgeDays} days`,
    });
  }
  if (i.openHighDiscrepancies > 0) {
    failures.push({
      code: 'OPEN_HIGH_DISCREPANCY',
      message: `${i.openHighDiscrepancies} HIGH-severity discrepancy(ies) still open`,
    });
  }
  if (i.latestTaxResult === 'FAIL') {
    failures.push({
      code: 'TAX_HEARTBEAT_FAILED',
      message: 'The tax heartbeat failed for the latest financial year',
    });
  }
  return { passed: failures.length === 0, failures };
}

/**
 * Release and renewal are locked after a tax FAIL until the bank re-attests (a bank PASS newer than
 * the failing tax signal).
 */
export function isTaxLocked(latestTaxFailAt: Date | null, latestBankPassAt: Date | null): boolean {
  if (!latestTaxFailAt) return false;
  return !latestBankPassAt || latestBankPassAt <= latestTaxFailAt;
}

/** Scheduled re-attestation: an ACTIVE deposit whose bank eye is STALE (or never checked). */
export function needsReattestation(i: {
  status: string;
  latestBank: SignalLike | null;
  hasOpenBankRequest: boolean;
  now: Date;
}): boolean {
  if (i.status !== 'ACTIVE' || i.hasOpenBankRequest) return false;
  const r = effectiveResult(i.latestBank, i.now);
  return r === 'STALE' || r === 'NOT_AVAILABLE';
}
