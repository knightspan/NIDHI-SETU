import type { Compounding } from '@nidhisetu/shared';
import { PERIODS_PER_YEAR } from './maturity-math.js';

/**
 * TRINETRA tax eye ("FDR Heartbeat"). A live FDR earns interest every year and the bank reports it
 * to the Income Tax department, where it appears in the institution's Annual Information Statement
 * (AIS). If a bank stops reporting interest, the deposit may have been closed prematurely.
 *
 * AIS interest is reported per bank and PAN, not per FDR, so the comparison is bank-wise.
 */

const DAY_MS = 86_400_000;

/** Indian financial year of a date: April–March, written "2025-26". */
export function fyOf(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** First day of the FY and the first day after it (ISO dates). */
export function fyBounds(fy: string): { start: string; endExclusive: string } {
  const start = Number(fy.slice(0, 4));
  return { start: `${start}-04-01`, endExclusive: `${start + 1}-04-01` };
}

/** The FY before the given one. */
export function previousFy(fy: string): string {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const years = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS / 365;

/**
 * Interest an FDR accrues within a financial year (compound growth between the later of issue/FY
 * start and the earlier of maturity/FY end). Banks report accrued interest on cumulative deposits.
 */
export function expectedInterestForFy(i: {
  principal: number;
  ratePct: number;
  issueDate: string;
  maturityDate: string;
  compounding: Compounding;
  fy: string;
}): number {
  const { start, endExclusive } = fyBounds(i.fy);
  const from = i.issueDate > start ? i.issueDate : start;
  const to = i.maturityDate < endExclusive ? i.maturityDate : endExclusive;
  if (to <= from) return 0;
  const n = PERIODS_PER_YEAR[i.compounding];
  const g = (t: number) => Math.pow(1 + i.ratePct / 100 / n, n * t);
  return i.principal * (g(years(i.issueDate, to)) - g(years(i.issueDate, from)));
}

export interface BankHeartbeat {
  result: 'PASS' | 'FAIL' | 'NOT_AVAILABLE';
  expected: number;
  reported: number;
}

/**
 * Bank-wise comparison: PASS if reported ≥ expected × (1 − tolerance); FAIL ("trail broken") if
 * materially lower or missing; NOT_AVAILABLE if nothing was expected from that bank this year.
 */
export function evaluateHeartbeat(
  expectedByBank: Record<string, number>,
  reportedByBank: Record<string, number>,
  tolerancePct: number,
): Record<string, BankHeartbeat> {
  const out: Record<string, BankHeartbeat> = {};
  for (const [bank, expected] of Object.entries(expectedByBank)) {
    const reported = reportedByBank[bank] ?? 0;
    const round = (n: number) => Math.round(n * 100) / 100;
    out[bank] = {
      result:
        expected <= 0
          ? 'NOT_AVAILABLE'
          : reported >= expected * (1 - tolerancePct / 100)
            ? 'PASS'
            : 'FAIL',
      expected: round(expected),
      reported: round(reported),
    };
  }
  return out;
}

/** The FY whose AIS should be requested on `today`, given the request date (MM-DD) after FY end. */
export function fyDueForAis(todayIso: string, requestMonthDay: string): string {
  const lastCompleted = previousFy(fyOf(todayIso));
  const requestFrom = `${Number(lastCompleted.slice(0, 4)) + 1}-${requestMonthDay}`;
  return todayIso >= requestFrom ? lastCompleted : previousFy(lastCompleted);
}
