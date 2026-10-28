import { describe, expect, it } from 'vitest';
import { checkMaturityMath, growthFactor, maturityValueFor, tenureYears } from './maturity-math.js';

const base = {
  principal: 1_000_000,
  ratePct: 7,
  issueDate: '2026-04-01',
  maturityDate: '2031-04-01',
  compounding: 'QUARTERLY' as const,
  tolerancePct: 1,
};

describe('maturity math', () => {
  it('compounds quarterly by default and supports other frequencies', () => {
    const years = tenureYears('2026-04-01', '2031-04-01');
    expect(years).toBeCloseTo(5.0027, 3); // includes one leap day
    expect(maturityValueFor(100_000, 8, 1, 'YEARLY')).toBeCloseTo(108_000, 6);
    expect(maturityValueFor(100_000, 8, 1, 'QUARTERLY')).toBeCloseTo(108_243.22, 1);
    expect(growthFactor(12, 1, 'MONTHLY')).toBeCloseTo(1.126825, 5);
  });

  it('passes when the printed value matches the computed one within tolerance', () => {
    const printed = maturityValueFor(
      1_000_000,
      7,
      tenureYears(base.issueDate, base.maturityDate),
      'QUARTERLY',
    );
    const r = checkMaturityMath({ ...base, printed: Math.round(printed) });
    expect(r.result).toBe('PASS');
    expect(r.differencePct).toBeLessThan(0.01);
  });

  it('fails and reverse-infers a 10× principal (altered amount)', () => {
    const years = tenureYears(base.issueDate, base.maturityDate);
    const printed = Math.round(maturityValueFor(2_500_000, 7, years, 'QUARTERLY'));
    const r = checkMaturityMath({ ...base, principal: 250_000, printed });
    expect(r.result).toBe('FAIL');
    expect(r.impliedMultiple).toBe(10);
    expect(r.impliedPrincipal).toBeCloseTo(2_500_000, -2);
    expect(r.note).toMatch(/10× the ₹2,50,000/);
  });

  it('fails without a round multiple when the numbers simply disagree', () => {
    const r = checkMaturityMath({ ...base, printed: 1_200_000 });
    expect(r.result).toBe('FAIL');
    expect(r.impliedMultiple).toBeNull();
  });

  it('respects the compounding configured for the bank', () => {
    const years = tenureYears(base.issueDate, base.maturityDate);
    const yearly = Math.round(maturityValueFor(1_000_000, 7, years, 'YEARLY'));
    // Quarterly vs yearly differ by ~0.9 % over five years at 7 %: visible with a 0.5 % tolerance.
    const strict = { ...base, tolerancePct: 0.5 };
    expect(checkMaturityMath({ ...strict, printed: yearly }).result).toBe('FAIL');
    expect(checkMaturityMath({ ...strict, compounding: 'YEARLY', printed: yearly }).result).toBe(
      'PASS',
    );
  });

  it('is not available without rate, maturity value or valid dates', () => {
    expect(checkMaturityMath({ ...base, ratePct: null, printed: 1 }).result).toBe('NOT_AVAILABLE');
    expect(checkMaturityMath({ ...base, printed: null }).result).toBe('NOT_AVAILABLE');
    expect(checkMaturityMath({ ...base, maturityDate: '2025-01-01', printed: 1 }).result).toBe(
      'NOT_AVAILABLE',
    );
  });
});
