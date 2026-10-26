import { DEFAULT_RULES } from '@nidhisetu/shared';
import { describe, expect, it } from 'vitest';
import { dateOnly } from './dates.js';
import { SegregationOfDutiesError } from './errors.js';
import {
  assertMakerChecker,
  checklistPassed,
  evaluateReleaseChecklist,
  type ReleaseContext,
} from './release.js';

const rule = DEFAULT_RULES['release.preconditions'];
const ok: ReleaseContext = {
  unresolvedDiscrepancies: 0,
  fullyBankConfirmed: true,
  hasNoc: true,
  replacementInFlight: false,
  activatedAt: dateOnly('2025-01-01'),
  today: dateOnly('2026-10-26'),
  requirement: { exempt: false, required: 1_000_000, otherHeld: 1_000_000 },
};

describe('release checklist', () => {
  it('passes when every enabled precondition holds', () => {
    const items = evaluateReleaseChecklist(ok, rule);
    expect(items.map((i) => i.code)).not.toContain('MIN_HOLDING_PERIOD'); // disabled by default
    expect(checklistPassed(items)).toBe(true);
  });

  it('reports each failing precondition with a reason', () => {
    const items = evaluateReleaseChecklist(
      {
        ...ok,
        unresolvedDiscrepancies: 2,
        fullyBankConfirmed: false,
        hasNoc: false,
        replacementInFlight: true,
        requirement: { exempt: false, required: 1_000_000, otherHeld: 0 },
      },
      rule,
    );
    expect(
      items
        .filter((i) => !i.passed)
        .map((i) => i.code)
        .sort(),
    ).toEqual(
      [
        'BANK_CONFIRMED',
        'DEPOSIT_NOT_REQUIRED_OR_REPLACED',
        'NOC_UPLOADED',
        'NO_OPEN_DISCREPANCIES',
        'NO_PENDING_RENEWAL',
      ].sort(),
    );
    expect(items.find((i) => i.code === 'NO_OPEN_DISCREPANCIES')!.detail).toMatch(
      /2 discrepancies/,
    );
    expect(checklistPassed(items)).toBe(false);
  });

  it('accepts exempt institutions regardless of other deposits', () => {
    const items = evaluateReleaseChecklist(
      { ...ok, requirement: { exempt: true, required: 0, otherHeld: 0 } },
      rule,
    );
    expect(items.find((i) => i.code === 'DEPOSIT_NOT_REQUIRED_OR_REPLACED')!.passed).toBe(true);
  });

  it('applies a configured minimum holding period', () => {
    const withHold = {
      checks: [{ code: 'MIN_HOLDING_PERIOD' as const, enabled: true, months: 24 }],
    };
    expect(evaluateReleaseChecklist(ok, withHold)[0]!.passed).toBe(false);
    expect(
      evaluateReleaseChecklist({ ...ok, activatedAt: dateOnly('2024-01-01') }, withHold)[0]!.passed,
    ).toBe(true);
    expect(evaluateReleaseChecklist({ ...ok, activatedAt: null }, withHold)[0]!.passed).toBe(false);
  });
});

describe('maker-checker', () => {
  it('allows a different approver', () => {
    expect(() =>
      assertMakerChecker({ requestedById: 'inst', recommendedById: 'ro' }, 'ca'),
    ).not.toThrow();
  });

  it('refuses the recommender, the requester, and unrecommended requests', () => {
    expect(() =>
      assertMakerChecker({ requestedById: 'inst', recommendedById: 'ro' }, 'ro'),
    ).toThrow(SegregationOfDutiesError);
    expect(() => assertMakerChecker({ requestedById: 'x', recommendedById: 'ro' }, 'x')).toThrow(
      /requester/,
    );
    expect(() =>
      assertMakerChecker({ requestedById: 'inst', recommendedById: null }, 'ca'),
    ).toThrow(/recommended/);
  });
});
