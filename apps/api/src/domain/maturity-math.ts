import type { Compounding } from '@nidhisetu/shared';

/**
 * TRINETRA document eye (a): recompute an FDR's maturity value from principal, rate, tenure and
 * compounding and compare it with the value printed on the receipt. A mismatch beyond tolerance is
 * a FAIL; the printed value is also run backwards to the principal it implies, which exposes an
 * altered amount (e.g. the scan reads ₹2,50,000 but the printed maturity value fits ₹25,00,000).
 */

export const PERIODS_PER_YEAR: Record<Compounding, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  HALF_YEARLY: 2,
  YEARLY: 1,
};

const DAY_MS = 86_400_000;

/** Tenure in years between two ISO dates (actual days / 365). */
export function tenureYears(issueDate: string, maturityDate: string): number {
  const ms = Date.parse(`${maturityDate}T00:00:00Z`) - Date.parse(`${issueDate}T00:00:00Z`);
  return ms / DAY_MS / 365;
}

/** Growth factor of one rupee: (1 + r/n)^(n·t). */
export function growthFactor(ratePct: number, years: number, compounding: Compounding): number {
  const n = PERIODS_PER_YEAR[compounding];
  return Math.pow(1 + ratePct / 100 / n, n * years);
}

export function maturityValueFor(
  principal: number,
  ratePct: number,
  years: number,
  compounding: Compounding,
): number {
  return principal * growthFactor(ratePct, years, compounding);
}

export interface MaturityCheckInput {
  /** Principal as read from the scan (falls back to the declared amount). */
  principal: number | null;
  ratePct: number | null;
  issueDate: string | null;
  maturityDate: string | null;
  compounding: Compounding;
  /** Maturity value printed on the receipt (or declared). */
  printed: number | null;
  tolerancePct: number;
}

export interface MaturityCheck {
  result: 'PASS' | 'FAIL' | 'NOT_AVAILABLE';
  expected: number | null;
  printed: number | null;
  differencePct: number | null;
  /** Principal the printed maturity value corresponds to. */
  impliedPrincipal: number | null;
  /** When the implied principal is a power-of-ten multiple of the one read (10, 100, 0.1…). */
  impliedMultiple: number | null;
  note: string;
}

const MULTIPLES = [1000, 100, 10, 0.1, 0.01, 0.001];
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function checkMaturityMath(i: MaturityCheckInput): MaturityCheck {
  const empty = {
    expected: null,
    printed: i.printed,
    differencePct: null,
    impliedPrincipal: null,
    impliedMultiple: null,
  };
  if (!i.principal || !i.ratePct || !i.issueDate || !i.maturityDate || !i.printed) {
    return {
      result: 'NOT_AVAILABLE',
      ...empty,
      note: 'Principal, rate, dates and maturity value are all needed',
    };
  }
  const years = tenureYears(i.issueDate, i.maturityDate);
  if (!(years > 0)) {
    return { result: 'NOT_AVAILABLE', ...empty, note: 'Maturity date is not after the issue date' };
  }
  const factor = growthFactor(i.ratePct, years, i.compounding);
  const expected = i.principal * factor;
  const differencePct = (Math.abs(i.printed - expected) / expected) * 100;
  const impliedPrincipal = i.printed / factor;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (differencePct <= i.tolerancePct) {
    return {
      result: 'PASS',
      expected: round2(expected),
      printed: i.printed,
      differencePct: round2(differencePct),
      impliedPrincipal: round2(impliedPrincipal),
      impliedMultiple: null,
      note: `Maturity value agrees with ${inr(i.principal)} at ${i.ratePct}% (${i.compounding.toLowerCase()})`,
    };
  }
  const ratio = impliedPrincipal / i.principal;
  const multiple =
    MULTIPLES.find((m) => Math.abs(ratio / m - 1) * 100 <= Math.max(i.tolerancePct, 1)) ?? null;
  const note = multiple
    ? `The printed maturity value ${inr(i.printed)} matches a principal of ${inr(impliedPrincipal)} — ${multiple}× the ${inr(i.principal)} on the receipt. The amount may have been altered.`
    : `The printed maturity value ${inr(i.printed)} differs from the computed ${inr(expected)} by ${round2(differencePct)}% (it implies a principal of ${inr(impliedPrincipal)}).`;
  return {
    result: 'FAIL',
    expected: round2(expected),
    printed: i.printed,
    differencePct: round2(differencePct),
    impliedPrincipal: round2(impliedPrincipal),
    impliedMultiple: multiple,
    note,
  };
}
