import { describe, expect, it } from 'vitest';
import { evaluateBankResponse, type HeldValues } from './bank-response.js';

const held: HeldValues = {
  fdrNumber: 'FD123',
  bankCode: 'SBIN',
  amount: '1000000.00',
  maturityDate: '2031-01-01',
  lienMarked: true,
  autoRenewal: false,
};

describe('evaluateBankResponse', () => {
  it('confirms when the bank agrees on everything', () => {
    const r = evaluateBankResponse(held, {
      exists: true,
      lienMarked: true,
      maturityDate: '2031-01-01',
      autoRenewal: false,
      amount: 1_000_000,
    });
    expect(r.outcome).toBe('CONFIRMED');
    expect(r.assertions.map((a) => a.field).sort()).toEqual(
      ['amount', 'autoRenewal', 'bankCode', 'fdrNumber', 'lienMarked', 'maturityDate'].sort(),
    );
    expect(r.assertions.find((a) => a.field === 'amount')!.value).toBe('1000000.00');
  });

  it('denies when the FDR does not exist, without asserting anything', () => {
    const r = evaluateBankResponse(held, {
      exists: false,
      lienMarked: null,
      maturityDate: null,
      autoRenewal: null,
    });
    expect(r).toMatchObject({ outcome: 'DENIED', assertions: [] });
    expect(r.contradictions[0]).toMatch(/does not exist/);
  });

  it('denies and records the bank values when they contradict AICTE', () => {
    const r = evaluateBankResponse(held, {
      exists: true,
      lienMarked: false,
      maturityDate: '2029-01-01',
      autoRenewal: true,
      amount: 100_000,
    });
    expect(r.outcome).toBe('DENIED');
    expect(r.contradictions).toHaveLength(4);
    expect(r.assertions.find((a) => a.field === 'maturityDate')!.value).toBe('2029-01-01');
  });

  it('treats an omitted amount as "not confirmed" rather than a contradiction', () => {
    const r = evaluateBankResponse(held, {
      exists: true,
      lienMarked: true,
      maturityDate: '2031-01-01',
      autoRenewal: false,
    });
    expect(r.outcome).toBe('CONFIRMED');
    expect(r.assertions.map((a) => a.field)).not.toContain('amount');
  });
});
