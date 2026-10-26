import { DEFAULT_RULES } from '@nidhisetu/shared';
import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dateOnly, daysBetween, istDateIso } from './dates.js';
import { escalationLevel, planEscalations, type Escalatable } from './escalation.js';
import { planReminders, reminderKey } from './reminders.js';
import { computeValidity } from './validity.js';

const rule = DEFAULT_RULES['validity.window']; // 90 days, 15 grace
const sla = DEFAULT_RULES['escalation.sla'];
const today = dateOnly('2026-10-26');

describe('dates', () => {
  it('handles IST dates, month ends and day differences', () => {
    expect(istDateIso(new Date('2026-10-26T20:00:00Z'))).toBe('2026-10-27');
    expect(addMonths(dateOnly('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(daysBetween(dateOnly('2026-10-26'), dateOnly('2026-12-25'))).toBe(60);
  });
});

describe('computeValidity', () => {
  const at = (days: number, status = 'ACTIVE' as const) => ({
    status,
    maturityDate: addDays(today, days),
  });

  it('classifies by distance to maturity', () => {
    expect(computeValidity(at(200), today, rule)).toBe('VALID');
    expect(computeValidity(at(91), today, rule)).toBe('VALID');
    expect(computeValidity(at(90), today, rule)).toBe('EXPIRING_SOON');
    expect(computeValidity(at(1), today, rule)).toBe('EXPIRING_SOON');
    expect(computeValidity(at(0), today, rule)).toBe('MATURED');
    expect(computeValidity(at(-15), today, rule)).toBe('MATURED');
    expect(computeValidity(at(-16), today, rule)).toBe('OVERDUE_RENEWAL');
  });

  it('is MATURED (not overdue) while a renewal is in progress', () => {
    expect(
      computeValidity(
        { status: 'RENEWAL_PENDING', maturityDate: addDays(today, -100) },
        today,
        rule,
      ),
    ).toBe('MATURED');
  });

  it('has no validity for instruments AICTE does not hold', () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'RELEASED', 'RENEWED', 'REJECTED'] as const) {
      expect(computeValidity({ status, maturityDate: addDays(today, 10) }, today, rule)).toBeNull();
    }
    expect(computeValidity({ status: 'ACTIVE', maturityDate: null }, today, rule)).toBeNull();
  });
});

describe('planReminders', () => {
  const offsets = [90, 60, 30, 7];
  const c = (id: string, days: number) => ({ id, maturityDate: addDays(today, days) });

  it('sends the offset whose window was just entered', () => {
    expect(planReminders([c('a', 90)], today, offsets, new Set())).toEqual([
      { instrumentId: 'a', offsetDays: 90, dueDate: today, notify: true },
    ]);
    expect(planReminders([c('a', 91)], today, offsets, new Set())).toEqual([]);
  });

  it('is idempotent: one reminder per instrument per offset', () => {
    const first = planReminders([c('a', 60)], today, offsets, new Set());
    const existing = new Set(first.map((r) => reminderKey(r.instrumentId, r.offsetDays)));
    expect(planReminders([c('a', 60)], today, offsets, existing)).toEqual([]);
    expect(planReminders([c('a', 59)], addDays(today, 1), offsets, existing)).toEqual([]);
  });

  it('after a clock jump records every crossed offset but announces only the nearest', () => {
    const r = planReminders([c('a', 5)], today, offsets, new Set());
    expect(r.map((x) => [x.offsetDays, x.notify])).toEqual([
      [7, true],
      [30, false],
      [60, false],
      [90, false],
    ]);
  });

  it('ignores matured instruments', () => {
    expect(planReminders([c('a', 0), c('b', -10)], today, offsets, new Set())).toEqual([]);
  });
});

describe('escalation', () => {
  const item = (type: Escalatable['type'], sinceDaysAgo: number): Escalatable => ({
    type,
    entityId: 'e1',
    instrumentId: 'i1',
    since: addDays(today, -sinceDaysAgo),
    label: 'x',
  });

  it('climbs one ladder level per missed SLA period, capped at the ladder', () => {
    // scrutiny SLA 7 days
    expect(escalationLevel('INSTRUMENT_SCRUTINY', addDays(today, -7), today, sla)).toBe(0);
    expect(escalationLevel('INSTRUMENT_SCRUTINY', addDays(today, -8), today, sla)).toBe(1);
    expect(escalationLevel('INSTRUMENT_SCRUTINY', addDays(today, -15), today, sla)).toBe(2);
    expect(escalationLevel('INSTRUMENT_SCRUTINY', addDays(today, -400), today, sla)).toBe(3);
  });

  it('escalates 0-day SLAs immediately, then weekly', () => {
    expect(escalationLevel('OVERDUE_RENEWAL', today, today, sla)).toBe(1);
    expect(escalationLevel('OVERDUE_RENEWAL', addDays(today, -6), today, sla)).toBe(1);
    expect(escalationLevel('OVERDUE_RENEWAL', addDays(today, -7), today, sla)).toBe(2);
    expect(escalationLevel('OVERDUE_RENEWAL', addDays(today, -30), today, sla)).toBe(3);
  });

  it('plans each level once, to the right role', () => {
    const plan = planEscalations([item('BANK_REQUEST', 20)], today, sla, new Set());
    expect(plan.map((p) => [p.level, p.toRole])).toEqual([
      [1, 'RO_OFFICER'],
      [2, 'BUREAU_OFFICER'],
    ]);
    const again = planEscalations(
      [item('BANK_REQUEST', 20)],
      today,
      sla,
      new Set(['BANK_REQUEST:e1:1', 'BANK_REQUEST:e1:2']),
    );
    expect(again).toEqual([]);
  });
});
