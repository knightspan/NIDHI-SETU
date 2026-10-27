import { describe, expect, it } from 'vitest';
import { maskEmail, maskPhone, maskPii } from './pii.js';

describe('PII masking', () => {
  it('masks emails and phones', () => {
    expect(maskEmail('meera.k@example.test')).toBe('m***@example.test');
    expect(maskPhone('9876543210')).toBe('••••••••10');
  });

  it('masks PII inside free text but leaves references and dates alone', () => {
    const s = maskPii(
      'login failed for meera.k@example.test from +91 98765 43210; account 123456789012; ' +
        'FDR SBI/FD/2026/104211 matures 2031-04-01, NS-2026-000002, IFSC SBIN0005943',
    );
    expect(s).toContain('m***@example.test');
    expect(s).not.toContain('98765');
    expect(s).toContain('••••••••9012');
    expect(s).toContain('SBI/FD/2026/104211');
    expect(s).toContain('2031-04-01');
    expect(s).toContain('NS-2026-000002');
    expect(s).toContain('SBIN0005943');
  });

  it('redacts tokens and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123_-';
    expect(maskPii(`GET /api/documents/download?token=${jwt}`)).toBe(
      'GET /api/documents/download?token=[redacted]',
    );
    expect(maskPii(`Authorization: Bearer abc.def`)).toBe('Authorization: Bearer [redacted]');
    expect(maskPii(`cookie ${jwt}`)).toBe('cookie [jwt]');
  });
});
