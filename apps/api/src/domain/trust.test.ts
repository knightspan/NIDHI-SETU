import { describe, expect, it } from 'vitest';
import {
  computeFieldState,
  computeFieldStates,
  describeMismatch,
  isFullyBankConfirmed,
  mismatchedFields,
  trustScore,
  type AssertionLike,
} from './trust.js';

const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
const a = (
  field: string,
  value: string,
  trust: AssertionLike['trust'],
  at: number,
): AssertionLike => ({
  field,
  value,
  trust,
  createdAt: t(at),
});

describe('field provenance', () => {
  it('takes the effective value from the highest trust level', () => {
    const s = computeFieldState('amount', [
      a('amount', '100000.00', 'DECLARED', 1),
      a('amount', '100000.00', 'OFFICER_VERIFIED', 2),
    ]);
    expect(s).toMatchObject({
      effectiveValue: '100000.00',
      effectiveTrust: 'OFFICER_VERIFIED',
      mismatch: false,
    });
  });

  it('flags a mismatch when trust levels disagree, and the higher level still wins', () => {
    const s = computeFieldState('amount', [
      a('amount', '100000.00', 'DECLARED', 1),
      a('amount', '10000.00', 'OCR_EXTRACTED', 2),
    ]);
    expect(s.mismatch).toBe(true);
    expect(s.effectiveValue).toBe('10000.00');
    expect(describeMismatch(s)).toBe('DECLARED "100000.00" vs OCR_EXTRACTED "10000.00"');
  });

  it('uses only the latest assertion per level, so a corrected declaration clears the mismatch', () => {
    const s = computeFieldState('amount', [
      a('amount', '100000.00', 'DECLARED', 1),
      a('amount', '10000.00', 'OCR_EXTRACTED', 2),
      a('amount', '10000.00', 'DECLARED', 3),
    ]);
    expect(s.mismatch).toBe(false);
  });

  it('ignores empty values when looking for disagreement', () => {
    const s = computeFieldState('ifsc', [
      a('ifsc', 'SBIN0001234', 'DECLARED', 1),
      a('ifsc', '', 'OCR_EXTRACTED', 2),
    ]);
    expect(s.mismatch).toBe(false);
  });

  it('scores 0 for missing or mismatched fields and 100 when everything is bank-confirmed', () => {
    expect(trustScore(computeFieldStates([]))).toBe(0);
    const allBank: AssertionLike[] = [
      'fdrNumber',
      'bankCode',
      'ifsc',
      'amount',
      'issueDate',
      'maturityDate',
      'depositorNames',
      'lienMarked',
      'autoRenewal',
    ].map((f, i) => a(f, 'x', 'BANK_CONFIRMED', i));
    const states = computeFieldStates(allBank);
    expect(trustScore(states)).toBe(100);
    expect(isFullyBankConfirmed(states)).toBe(true);

    const withConflict = computeFieldStates([...allBank, a('amount', 'y', 'DECLARED', 50)]);
    expect(mismatchedFields(withConflict)).toEqual(['amount']);
    expect(trustScore(withConflict)).toBe(89);
    expect(isFullyBankConfirmed(withConflict)).toBe(false);
  });

  it('gives declared-only instruments a low score', () => {
    const states = computeFieldStates([
      a('amount', '1', 'DECLARED', 1),
      a('fdrNumber', 'X', 'DECLARED', 1),
    ]);
    expect(trustScore(states)).toBe(6);
  });
});
