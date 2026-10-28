import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AisJsonV1Parser, AisParseError, interestByBank, parseAis } from './ais-parser.js';
import {
  evaluateHeartbeat,
  expectedInterestForFy,
  fyBounds,
  fyDueForAis,
  fyOf,
  previousFy,
} from './tax-heartbeat.js';

const sample: unknown = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../../fixtures/ais/sample-fy2025-26.json'),
    'utf8',
  ),
);
const banks = [
  { code: 'SBIN', name: 'State Bank of India', aliases: ['SBI'] },
  { code: 'HDFC', name: 'HDFC Bank', aliases: [] },
  { code: 'PUNB', name: 'Punjab National Bank', aliases: ['PNB'] },
];

describe('financial years', () => {
  it('maps dates to April–March years', () => {
    expect(fyOf('2026-03-31')).toBe('2025-26');
    expect(fyOf('2026-04-01')).toBe('2026-27');
    expect(fyBounds('2025-26')).toEqual({ start: '2025-04-01', endExclusive: '2026-04-01' });
    expect(previousFy('2000-01')).toBe('1999-00');
  });
  it('requests the last completed FY only after the configured date', () => {
    expect(fyDueForAis('2026-06-14', '06-15')).toBe('2024-25');
    expect(fyDueForAis('2026-06-15', '06-15')).toBe('2025-26');
    expect(fyDueForAis('2027-01-10', '06-15')).toBe('2025-26');
  });
});

describe('expected interest', () => {
  const fdr = { principal: 1_000_000, ratePct: 7, compounding: 'QUARTERLY' as const };
  it('accrues a full year inside the tenure', () => {
    const e = expectedInterestForFy({
      ...fdr,
      issueDate: '2024-04-01',
      maturityDate: '2029-04-01',
      fy: '2025-26',
    });
    expect(e).toBeGreaterThan(70_000);
    expect(e).toBeLessThan(80_000);
  });
  it('accrues part of the year around issue and maturity, nothing outside it', () => {
    const half = expectedInterestForFy({
      ...fdr,
      issueDate: '2025-10-01',
      maturityDate: '2030-10-01',
      fy: '2025-26',
    });
    expect(half).toBeGreaterThan(30_000);
    expect(half).toBeLessThan(40_000);
    expect(
      expectedInterestForFy({
        ...fdr,
        issueDate: '2020-04-01',
        maturityDate: '2025-04-01',
        fy: '2025-26',
      }),
    ).toBe(0);
  });
});

describe('AIS parser (assumed format)', () => {
  it('extracts interest from deposits per reporting source and maps sources to banks', () => {
    const p = parseAis(sample);
    expect(p).toMatchObject({ parser: 'ais-json-v1-assumed', fy: '2025-26', pan: 'AAATS0000F' });
    expect(p.interestFromDeposits).toHaveLength(4); // the rent row is ignored
    const { byBank, unmatched } = interestByBank(p.interestFromDeposits, banks);
    expect(byBank).toEqual({ SBIN: 71862.5, HDFC: 108421, PUNB: 1520 });
    expect(unmatched).toEqual([{ source: 'Fictional Co-operative Bank', amount: 900 }]);
  });
  it('rejects files it does not understand', () => {
    expect(() => parseAis({ hello: 'world' })).toThrow(AisParseError);
    expect(() =>
      new AisJsonV1Parser().parse({ financialYear: 'FY25', informationCategories: [] }),
    ).toThrow(/financial year/);
  });
});

describe('heartbeat evaluation', () => {
  it('passes within tolerance, fails when interest stops, skips banks with nothing expected', () => {
    const r = evaluateHeartbeat(
      { SBIN: 70_000, HDFC: 50_000, PUNB: 0 },
      { SBIN: 66_000, PUNB: 10 },
      10,
    );
    expect(r.SBIN!.result).toBe('PASS'); // 66 000 ≥ 63 000
    expect(r.HDFC).toEqual({ result: 'FAIL', expected: 50_000, reported: 0 });
    expect(r.PUNB!.result).toBe('NOT_AVAILABLE');
    expect(evaluateHeartbeat({ SBIN: 70_000 }, { SBIN: 60_000 }, 10).SBIN!.result).toBe('FAIL');
  });
});
