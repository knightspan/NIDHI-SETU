import { describe, expect, it } from 'vitest';
import { IFSC_REGEX, normalizeFieldValue } from './fields.js';
import { DEFAULT_RULES, RULE_CODES, parseRuleConfig } from './rules.js';
import { hasPermission } from './permissions.js';

describe('normalizeFieldValue', () => {
  it('normalises amounts written in Indian notation', () => {
    expect(normalizeFieldValue('amount', ' ₹1,00,000 ')).toBe('100000.00');
    expect(normalizeFieldValue('amount', 100000)).toBe('100000.00');
  });

  it('normalises depositor names order- and case-insensitively', () => {
    expect(normalizeFieldValue('depositorNames', ['aicte', ' Shanti  Vidya Trust '])).toBe(
      normalizeFieldValue('depositorNames', 'SHANTI VIDYA TRUST; AICTE'),
    );
  });

  it('normalises booleans, dates and identifiers', () => {
    expect(normalizeFieldValue('lienMarked', true)).toBe('true');
    expect(normalizeFieldValue('autoRenewal', 'no')).toBe('false');
    expect(normalizeFieldValue('maturityDate', new Date('2030-01-05T00:00:00Z'))).toBe(
      '2030-01-05',
    );
    expect(normalizeFieldValue('ifsc', ' sbin0001234 ')).toBe('SBIN0001234');
  });

  it('validates IFSC format', () => {
    expect(IFSC_REGEX.test('SBIN0001234')).toBe(true);
    expect(IFSC_REGEX.test('SBIN1001234')).toBe(false);
  });
});

describe('default rules', () => {
  it('all parse against their schemas', () => {
    for (const code of RULE_CODES)
      expect(() => parseRuleConfig(code, DEFAULT_RULES[code])).not.toThrow();
  });

  it('rejects an invalid config', () => {
    expect(() =>
      parseRuleConfig('reminders.maturity', { offsetsDays: [], recipients: [] }),
    ).toThrow();
  });
});

describe('permissions', () => {
  it('keeps the system admin away from release approval', () => {
    expect(hasPermission('SYS_ADMIN', 'release:approve')).toBe(false);
    expect(hasPermission('COMPETENT_AUTHORITY', 'release:approve')).toBe(true);
  });
});
