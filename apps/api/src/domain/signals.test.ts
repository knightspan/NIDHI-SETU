import { DEFAULT_RULES, nextStates, canTransition, findTransition } from '@nidhisetu/shared';
import { describe, expect, it } from 'vitest';
import { manualEditsPerInstrument, trustMixByRegion } from './effort.js';
import {
  computeRisk,
  computeTrustScore,
  effectiveResult,
  evaluateReverificationGate,
  isTaxLocked,
  needsReattestation,
} from './signals.js';

const now = new Date('2026-10-28T00:00:00Z');
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
const sig = (
  result: 'PASS' | 'FAIL' | 'STALE' | 'NOT_AVAILABLE',
  ageDays = 0,
  validForDays = 365,
) => ({
  result,
  checkedAt: days(ageDays),
  validUntil: new Date(days(ageDays).getTime() + validForDays * 86_400_000),
});

describe('effective eye result', () => {
  it('turns an expired PASS into STALE and a missing signal into NOT_AVAILABLE', () => {
    expect(effectiveResult(sig('PASS', 10), now)).toBe('PASS');
    expect(effectiveResult(sig('PASS', 400), now)).toBe('STALE');
    expect(effectiveResult(sig('FAIL', 400), now)).toBe('FAIL');
    expect(effectiveResult(null, now)).toBe('NOT_AVAILABLE');
  });
});

describe('trust score (TRINETRA)', () => {
  const rule = DEFAULT_RULES['trust.weights'];
  it('is 100 with full provenance and three fresh passes, lower as eyes fail or age', () => {
    const allPass = { BANK: sig('PASS'), TAX: sig('PASS'), DOCUMENT: sig('PASS') };
    expect(computeTrustScore(100, allPass, rule, now)).toBe(100);
    const older = { ...allPass, BANK: sig('PASS', 180) };
    expect(computeTrustScore(100, older, rule, now)).toBeLessThan(100);
    const failed = { ...allPass, TAX: sig('FAIL') };
    expect(computeTrustScore(100, failed, rule, now)).toBe(85);
    expect(computeTrustScore(0, { BANK: null, TAX: null, DOCUMENT: null }, rule, now)).toBe(30);
  });
});

describe('risk level (feature 1)', () => {
  const rule = DEFAULT_RULES['risk.weights'];
  it('is LOW for a trusted deposit far from maturity', () => {
    expect(
      computeRisk(
        { trustScore: 95, openHighDiscrepancies: 0, failedSignals: 0, daysToMaturity: 500 },
        rule,
      ).level,
    ).toBe('LOW');
  });
  it('rises with low trust, near maturity, HIGH discrepancies and failed signals', () => {
    expect(
      computeRisk(
        { trustScore: 40, openHighDiscrepancies: 0, failedSignals: 0, daysToMaturity: 20 },
        rule,
      ).level,
    ).toBe('MEDIUM');
    expect(
      computeRisk(
        { trustScore: 80, openHighDiscrepancies: 1, failedSignals: 1, daysToMaturity: 500 },
        rule,
      ).level,
    ).toBe('HIGH');
    expect(
      computeRisk(
        { trustScore: 100, openHighDiscrepancies: 9, failedSignals: 0, daysToMaturity: null },
        rule,
      ).score,
    ).toBe(9);
  });
});

describe('re-verification gate', () => {
  const base = {
    latestBankPassAt: days(5),
    openHighDiscrepancies: 0,
    latestTaxResult: 'PASS' as const,
    now,
    maxBankPassAgeDays: 30,
  };
  it('passes with a fresh bank PASS, no HIGH discrepancy and tax not failed', () => {
    expect(evaluateReverificationGate(base)).toEqual({ passed: true, failures: [] });
    expect(evaluateReverificationGate({ ...base, latestTaxResult: null }).passed).toBe(true);
  });
  it('lists every failed condition', () => {
    const r = evaluateReverificationGate({
      ...base,
      latestBankPassAt: days(60),
      openHighDiscrepancies: 2,
      latestTaxResult: 'FAIL',
    });
    expect(r.failures.map((f) => f.code)).toEqual([
      'NO_FRESH_BANK_PASS',
      'OPEN_HIGH_DISCREPANCY',
      'TAX_HEARTBEAT_FAILED',
    ]);
  });
  it('locks release and renewal after a tax FAIL until the bank re-attests', () => {
    expect(isTaxLocked(days(10), days(20))).toBe(true);
    expect(isTaxLocked(days(10), days(2))).toBe(false);
    expect(isTaxLocked(null, null)).toBe(false);
  });
});

describe('scheduled re-attestation (feature 2)', () => {
  it('asks the bank again only for ACTIVE deposits whose bank eye is stale', () => {
    const stale = sig('PASS', 400);
    expect(
      needsReattestation({ status: 'ACTIVE', latestBank: stale, hasOpenBankRequest: false, now }),
    ).toBe(true);
    expect(
      needsReattestation({ status: 'ACTIVE', latestBank: null, hasOpenBankRequest: false, now }),
    ).toBe(true);
    expect(
      needsReattestation({
        status: 'ACTIVE',
        latestBank: sig('PASS', 10),
        hasOpenBankRequest: false,
        now,
      }),
    ).toBe(false);
    expect(
      needsReattestation({ status: 'ACTIVE', latestBank: stale, hasOpenBankRequest: true, now }),
    ).toBe(false);
    expect(
      needsReattestation({ status: 'RELEASED', latestBank: stale, hasOpenBankRequest: false, now }),
    ).toBe(false);
  });
});

describe('forfeiture path (feature 3)', () => {
  it('runs ACTIVE → PROPOSED → APPROVED → FORFEITED with maker, checker and finance', () => {
    expect(canTransition('ACTIVE', 'FORFEITURE_PROPOSED', 'RO_OFFICER')).toBe(true);
    expect(canTransition('ACTIVE', 'FORFEITURE_PROPOSED', 'INSTITUTION_USER')).toBe(false);
    expect(canTransition('FORFEITURE_PROPOSED', 'FORFEITURE_APPROVED', 'COMPETENT_AUTHORITY')).toBe(
      true,
    );
    expect(canTransition('FORFEITURE_PROPOSED', 'FORFEITURE_APPROVED', 'RO_OFFICER')).toBe(false);
    expect(canTransition('FORFEITURE_APPROVED', 'FORFEITED', 'FINANCE_OFFICER')).toBe(true);
    expect(nextStates('FORFEITED')).toEqual([]);
    expect(canTransition('FORFEITURE_PROPOSED', 'ACTIVE', 'COMPETENT_AUTHORITY')).toBe(true);
  });
  it('puts both approvals behind the same re-verification gate', () => {
    expect(findTransition('FORFEITURE_PROPOSED', 'FORFEITURE_APPROVED')?.gate).toBe(
      'REVERIFICATION',
    );
    expect(findTransition('RELEASE_RECOMMENDED', 'RELEASE_APPROVED')?.gate).toBe('REVERIFICATION');
  });
});

describe('manual effort (feature 4)', () => {
  it('averages manual edits over all instruments and reports the median', () => {
    const r = manualEditsPerInstrument(
      [{ instrumentId: 'a' }, { instrumentId: 'a' }, { instrumentId: 'b' }],
      4,
    );
    expect(r).toEqual({ edits: 3, perInstrument: 0.75, instrumentsEdited: 2, median: 0.5 });
    expect(manualEditsPerInstrument([], 0).perInstrument).toBe(0);
  });
});

describe('trust mix by region (feature 5)', () => {
  it('stacks tiers per region, largest region first', () => {
    const r = trustMixByRegion([
      { region: 'West', tier: 'BANK_CONFIRMED', count: 2 },
      { region: 'North', tier: 'BANK_CONFIRMED', count: 5 },
      { region: 'North', tier: 'UNVERIFIED', count: 1 },
      { region: 'West', tier: 'OFFICER_VERIFIED', count: 1 },
    ]);
    expect(r).toEqual([
      { region: 'North', BANK_CONFIRMED: 5, OFFICER_VERIFIED: 0, UNVERIFIED: 1, total: 6 },
      { region: 'West', BANK_CONFIRMED: 2, OFFICER_VERIFIED: 1, UNVERIFIED: 0, total: 3 },
    ]);
  });
});
