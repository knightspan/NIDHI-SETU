import { DEFAULT_RULES, normalizeFieldValue, type FieldKey } from '@nidhisetu/shared';
import { describe, expect, it } from 'vitest';
import { dateOnly } from './dates.js';
import {
  evaluateDiscrepancyRules,
  requiredAmount,
  type DiscrepancyContext,
} from './discrepancy-rules.js';
import { computeFieldStates, type AssertionLike } from './trust.js';

const declared = (values: Partial<Record<FieldKey, unknown>>, at = 1): AssertionLike[] =>
  Object.entries(values).map(([field, value]) => ({
    field,
    value: normalizeFieldValue(field as FieldKey, value),
    trust: 'DECLARED',
    createdAt: new Date(at),
  }));

const GOOD = {
  fdrNumber: 'FD123',
  bankCode: 'SBIN',
  ifsc: 'SBIN0001234',
  amount: 1_000_000,
  issueDate: '2026-01-01',
  maturityDate: '2031-01-01',
  depositorNames: ['AICTE', 'Trust'],
  lienMarked: true,
  autoRenewal: false,
};

function ctx(
  over: Partial<DiscrepancyContext> = {},
  assertions = declared(GOOD),
): DiscrepancyContext {
  return {
    states: computeFieldStates(assertions),
    institution: { yearEstablished: 2022, programmes: ['UG_ENGINEERING'] },
    today: dateOnly('2026-10-26'),
    rules: {
      eligibility: DEFAULT_RULES['eligibility.exemption'],
      amount: DEFAULT_RULES['amount.required'],
      validity: DEFAULT_RULES['validity.window'],
      discrepancy: DEFAULT_RULES['discrepancy.rules'],
    },
    otherHeldAmount: 0,
    duplicateFdrs: [],
    duplicateDocuments: [],
    knownBankCodes: new Set(['SBIN', 'HDFC']),
    documentTypes: new Set(['FDR_SCAN']),
    submitted: true,
    ...over,
  };
}
const codes = (c: DiscrepancyContext) => evaluateDiscrepancyRules(c).map((f) => f.code);

describe('requiredAmount', () => {
  it('sums programme amounts, falling back to the default', () => {
    expect(
      requiredAmount(
        { yearEstablished: 2022, programmes: ['UG_ENGINEERING', 'MBA'] },
        { exemptIfAgeYearsAtLeast: 10 },
        DEFAULT_RULES['amount.required'],
        dateOnly('2026-01-01'),
      ),
    ).toEqual({ required: 1_500_000, exempt: false, ageYears: 4 });
  });

  it('exempts institutions past the age threshold', () => {
    expect(
      requiredAmount(
        { yearEstablished: 2000, programmes: ['MBA'] },
        { exemptIfAgeYearsAtLeast: 10 },
        DEFAULT_RULES['amount.required'],
        dateOnly('2026-01-01'),
      ).exempt,
    ).toBe(true);
    expect(
      requiredAmount(
        { yearEstablished: 2000, programmes: ['MBA'] },
        { exemptIfAgeYearsAtLeast: null },
        DEFAULT_RULES['amount.required'],
        dateOnly('2026-01-01'),
      ).exempt,
    ).toBe(false);
  });
});

describe('evaluateDiscrepancyRules', () => {
  it('finds nothing wrong with a clean, documented instrument', () => {
    expect(codes(ctx())).toEqual([]);
  });

  it('flags declared-vs-OCR mismatches with a stable key', () => {
    const a = [
      ...declared(GOOD),
      {
        field: 'amount',
        value: '100000.00',
        trust: 'OCR_EXTRACTED' as const,
        createdAt: new Date(2),
      },
    ];
    const f = evaluateDiscrepancyRules(ctx({}, a));
    expect(f.map((x) => x.code)).toContain('FIELD_MISMATCH');
    const mm = f.find((x) => x.code === 'FIELD_MISMATCH')!;
    expect(mm.field).toBe('amount');
    expect(mm.description).toContain('OCR_EXTRACTED "100000.00"');
    expect(evaluateDiscrepancyRules(ctx({}, a)).find((x) => x.code === 'FIELD_MISMATCH')!.key).toBe(
      mm.key,
    );
  });

  it('checks the amount against the requirement, counting other live deposits', () => {
    const small = declared({ ...GOOD, amount: 400_000 });
    expect(codes(ctx({}, small))).toContain('AMOUNT_BELOW_REQUIRED');
    expect(codes(ctx({ otherHeldAmount: 600_000 }, small))).not.toContain('AMOUNT_BELOW_REQUIRED');
    // Exempt institution.
    expect(
      codes(ctx({ institution: { yearEstablished: 1990, programmes: ['UG_ENGINEERING'] } }, small)),
    ).not.toContain('AMOUNT_BELOW_REQUIRED');
  });

  it('flags a maturity before the required tenure', () => {
    expect(codes(ctx({}, declared({ ...GOOD, maturityDate: '2028-01-01' })))).toContain(
      'MATURITY_BEFORE_REQUIRED_END',
    );
  });

  it('flags missing joint name and unmarked lien', () => {
    const c = codes(
      ctx({}, declared({ ...GOOD, depositorNames: ['Trust only'], lienMarked: false })),
    );
    expect(c).toEqual(expect.arrayContaining(['NOT_JOINT_NAME', 'LIEN_NOT_MARKED']));
  });

  it('flags duplicate FDRs as HIGH severity and duplicate documents', () => {
    const f = evaluateDiscrepancyRules(
      ctx({
        duplicateFdrs: [{ refNo: 'NS-2026-000009', institutionName: 'Other Institute' }],
        duplicateDocuments: [{ documentType: 'FDR_SCAN', otherRefNo: 'NS-2026-000010' }],
      }),
    );
    expect(f.find((x) => x.code === 'DUPLICATE_FDR')!.severity).toBe('HIGH');
    expect(f.map((x) => x.code)).toContain('DUPLICATE_DOCUMENT');
  });

  it('validates IFSC format, IFSC/bank consistency and the bank master', () => {
    expect(codes(ctx({}, declared({ ...GOOD, ifsc: 'SBIN1234' })))).toContain('INVALID_IFSC');
    expect(codes(ctx({}, declared({ ...GOOD, ifsc: 'HDFC0001234' })))).toContain('INVALID_IFSC');
    expect(codes(ctx({}, declared({ ...GOOD, bankCode: 'ZZZZ', ifsc: 'ZZZZ0001234' })))).toContain(
      'UNKNOWN_BANK',
    );
  });

  it('requires mandatory documents only after submission', () => {
    expect(codes(ctx({ documentTypes: new Set() }))).toContain('MISSING_DOCUMENT');
    expect(codes(ctx({ documentTypes: new Set(), submitted: false }))).not.toContain(
      'MISSING_DOCUMENT',
    );
  });

  it('respects disabled rules and configured severities', () => {
    const discrepancy = {
      ...DEFAULT_RULES['discrepancy.rules'],
      rules: DEFAULT_RULES['discrepancy.rules'].rules.map((r) =>
        r.code === 'LIEN_NOT_MARKED'
          ? { ...r, enabled: false }
          : r.code === 'MISSING_DOCUMENT'
            ? { ...r, severity: 'LOW' as const }
            : r,
      ),
    };
    const c = ctx(
      { documentTypes: new Set(), rules: { ...ctx().rules, discrepancy } },
      declared({ ...GOOD, lienMarked: false }),
    );
    const f = evaluateDiscrepancyRules(c);
    expect(f.map((x) => x.code)).not.toContain('LIEN_NOT_MARKED');
    expect(f.find((x) => x.code === 'MISSING_DOCUMENT')!.severity).toBe('LOW');
  });
});
