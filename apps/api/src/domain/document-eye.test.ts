import { describe, expect, it } from 'vitest';
import { checkDuplicates, checkIfsc, combineDocumentEye, normaliseBranch } from './document-eye.js';
import type { MaturityCheck } from './maturity-math.js';

const master = { ifsc: 'SBIN0123456', bankCode: 'SBIN', branch: 'MG Road', city: 'Pune' };
const ok = {
  ifsc: 'SBIN0123456',
  bankCode: 'SBIN',
  branch: 'M.G. Road Branch',
  master,
  masterHasBank: true,
};

describe('IFSC check', () => {
  it('passes when the IFSC is in the master and the branch matches', () => {
    expect(normaliseBranch('M.G. Road Branch')).toBe(normaliseBranch('MG ROAD'));
    expect(checkIfsc(ok)).toMatchObject({ result: 'PASS', masterBranch: 'MG Road' });
  });
  it('fails on bad format, wrong bank, unknown code or another branch', () => {
    expect(checkIfsc({ ...ok, ifsc: 'SBIN123' }).result).toBe('FAIL');
    expect(checkIfsc({ ...ok, bankCode: 'HDFC' }).note).toMatch(/does not belong/);
    expect(checkIfsc({ ...ok, master: null }).note).toMatch(/not in the IFSC master/);
    expect(checkIfsc({ ...ok, branch: 'Civil Lines' })).toMatchObject({
      result: 'FAIL',
      masterBranch: 'MG Road',
    });
  });
  it('is not available without an IFSC or before the master is loaded for the bank', () => {
    expect(checkIfsc({ ...ok, ifsc: null }).result).toBe('NOT_AVAILABLE');
    expect(checkIfsc({ ...ok, master: null, masterHasBank: false }).result).toBe('NOT_AVAILABLE');
  });
});

describe('duplicate check', () => {
  const other = { refNo: 'NS-2026-000001', institutionName: 'Other Institute' };
  it('flags a recycled FDR number or scan', () => {
    const r = checkDuplicates({
      hasFdrKey: true,
      hasScan: true,
      sameFdr: [other],
      sameDocument: [other],
    });
    expect(r.result).toBe('FAIL');
    expect(r.note).toMatch(/same FDR number.*same scan/);
  });
  it('passes when unique, and is not available with nothing to compare', () => {
    expect(
      checkDuplicates({ hasFdrKey: true, hasScan: false, sameFdr: [], sameDocument: [] }).result,
    ).toBe('PASS');
    expect(
      checkDuplicates({ hasFdrKey: false, hasScan: false, sameFdr: [], sameDocument: [] }).result,
    ).toBe('NOT_AVAILABLE');
  });
});

describe('document eye', () => {
  const mm = (result: MaturityCheck['result']): MaturityCheck => ({
    result,
    expected: null,
    printed: null,
    differencePct: null,
    impliedPrincipal: null,
    impliedMultiple: null,
    note: '',
  });
  const ifsc = (result: 'PASS' | 'FAIL' | 'NOT_AVAILABLE') => ({
    result,
    note: '',
    masterBranch: null,
  });
  const dup = (result: 'PASS' | 'FAIL' | 'NOT_AVAILABLE') => ({
    result,
    note: '',
    sameFdr: [],
    sameDocument: [],
  });
  it('fails if any check fails, passes with at least one pass, otherwise not available', () => {
    expect(combineDocumentEye(mm('PASS'), ifsc('FAIL'), dup('PASS')).result).toBe('FAIL');
    expect(combineDocumentEye(mm('NOT_AVAILABLE'), ifsc('PASS'), dup('NOT_AVAILABLE')).result).toBe(
      'PASS',
    );
    expect(
      combineDocumentEye(mm('NOT_AVAILABLE'), ifsc('NOT_AVAILABLE'), dup('NOT_AVAILABLE')).result,
    ).toBe('NOT_AVAILABLE');
  });
});
