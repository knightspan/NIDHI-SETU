import { describe, expect, it } from 'vitest';
import { mapOcr, type OcrServiceResult } from './ocr-mapping.js';

const banks = [
  { code: 'SBIN', name: 'State Bank of India' },
  { code: 'HDFC', name: 'HDFC Bank' },
];

const base: OcrServiceResult = {
  fields: {
    fdr_number: 'sbi/fd/1',
    bank_name: 'State Bank Of India',
    ifsc: 'SBIN0001234',
    amount: 1500000,
    issue_date: '2026-04-01',
    maturity_date: '2031-04-01',
    depositor_names: ['AICTE', 'Shiksha Trust'],
  },
  confidence: {
    fdr_number: 0.97,
    bank_name: 0.95,
    ifsc: 0.96,
    amount: 0.7,
    issue_date: 0.9,
    maturity_date: 0.9,
    depositor_names: 0.92,
  },
  raw_text: '…',
  engine: 'rapidocr',
};

describe('mapOcr', () => {
  it('normalises values and resolves the bank from the master', () => {
    const r = mapOcr(base, banks);
    expect(r.fields).toEqual({
      fdrNumber: 'SBI/FD/1',
      ifsc: 'SBIN0001234',
      amount: '1500000.00',
      issueDate: '2026-04-01',
      maturityDate: '2031-04-01',
      depositorNames: 'AICTE; SHIKSHA TRUST',
      bankCode: 'SBIN',
    });
    expect(r.lowConfidence).toEqual(['amount']);
  });

  it('falls back to the IFSC prefix with reduced confidence, and skips empty fields', () => {
    const r = mapOcr(
      { ...base, fields: { ...base.fields, bank_name: null, fdr_number: null } },
      banks,
    );
    expect(r.fields.bankCode).toBe('SBIN');
    expect(r.confidence.bankCode).toBeCloseTo(0.864);
    expect(r.fields).not.toHaveProperty('fdrNumber');
  });

  it('leaves the bank empty when it cannot be resolved', () => {
    const r = mapOcr(
      { ...base, fields: { ...base.fields, bank_name: 'Unknown Bank', ifsc: 'ZZZZ0000001' } },
      banks,
    );
    expect(r.fields.bankCode).toBeUndefined();
  });
});
