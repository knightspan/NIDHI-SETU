import { DEFAULT_RULES, RULE_CODES } from '@nidhisetu/shared';
import { describe, expect, it } from 'vitest';
import {
  MissingRuleError,
  pickRuleVersion,
  resolveRules,
  type RuleVersionLike,
} from './rules-engine.js';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('rules engine', () => {
  const versions: RuleVersionLike[] = [
    {
      code: 'reminders.maturity',
      version: 1,
      effectiveFrom: d('2020-01-01'),
      config: { offsetsDays: [90], recipients: ['RO_OFFICER'] },
    },
    {
      code: 'reminders.maturity',
      version: 2,
      effectiveFrom: d('2026-06-01'),
      config: { offsetsDays: [60, 30], recipients: ['RO_OFFICER'] },
    },
    {
      code: 'reminders.maturity',
      version: 3,
      effectiveFrom: d('2027-01-01'),
      config: { offsetsDays: [7], recipients: ['RO_OFFICER'] },
    },
  ];

  it('picks the latest version already in force', () => {
    expect(pickRuleVersion(versions, 'reminders.maturity', d('2026-01-01'))!.version).toBe(1);
    expect(pickRuleVersion(versions, 'reminders.maturity', d('2026-10-26'))!.version).toBe(2);
    expect(pickRuleVersion(versions, 'reminders.maturity', d('2027-03-01'))!.version).toBe(3);
  });

  it('ignores scheduled future versions and unknown codes', () => {
    expect(pickRuleVersion(versions, 'reminders.maturity', d('2019-01-01'))).toBeUndefined();
    expect(pickRuleVersion(versions, 'nope', d('2026-01-01'))).toBeUndefined();
  });

  it('resolves and validates the full rule set', () => {
    const all = RULE_CODES.map((code) => ({
      code,
      version: 1,
      effectiveFrom: d('2020-01-01'),
      config: DEFAULT_RULES[code],
    }));
    const r = resolveRules(all, d('2026-01-01'));
    expect(r['validity.window'].expiringSoonDays).toBe(90);
    expect(() => resolveRules(all.slice(1), d('2026-01-01'))).toThrow(MissingRuleError);
    const broken = all.map((v) =>
      v.code === 'escalation.sla' ? { ...v, config: { ladder: [] } } : v,
    );
    expect(() => resolveRules(broken, d('2026-01-01'))).toThrow();
  });
});
