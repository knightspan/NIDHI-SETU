import { describe, expect, it } from 'vitest';
import { fdrKey } from './fdr-key.js';

describe('fdrKey', () => {
  it('folds separators, case and look-alike characters', () => {
    const k = fdrKey('SBIN', 'SBI/FD/2026/104211');
    expect(fdrKey('SBIN', 'sbi-fd 2026 1O4211')).toBe(k);
    expect(fdrKey('SBIN', 'SB1/FD/2O26/1042II')).toBe(k);
  });
  it('keeps different receipts and different banks apart', () => {
    expect(fdrKey('SBIN', 'SBI/FD/2026/104212')).not.toBe(fdrKey('SBIN', 'SBI/FD/2026/104211'));
    expect(fdrKey('HDFC', '50301234')).not.toBe(fdrKey('SBIN', '50301234'));
  });
  it('needs both bank and number', () => {
    expect(fdrKey(null, '123')).toBeNull();
    expect(fdrKey('SBIN', '//')).toBeNull();
  });
});
