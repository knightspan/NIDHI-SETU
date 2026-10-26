import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATUSES } from './enums.js';
import {
  IllegalTransitionError,
  TERMINAL_STATES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  isPreActive,
  nextStates,
} from './state-machine.js';

describe('lifecycle state machine', () => {
  it('follows the happy path from DRAFT to ACTIVE', () => {
    const path = [
      ['DRAFT', 'SUBMITTED', 'INSTITUTION_USER'],
      ['SUBMITTED', 'UNDER_SCRUTINY', 'RO_OFFICER'],
      ['UNDER_SCRUTINY', 'OFFICER_VERIFIED', 'RO_OFFICER'],
      ['OFFICER_VERIFIED', 'BANK_CONFIRMATION_PENDING', 'RO_OFFICER'],
      ['BANK_CONFIRMATION_PENDING', 'BANK_CONFIRMED', 'BANK_OFFICER'],
      ['BANK_CONFIRMED', 'ACTIVE', 'SYSTEM'],
    ] as const;
    for (const [from, to, actor] of path) expect(canTransition(from, to, actor)).toBe(true);
  });

  it('supports the discrepancy loop', () => {
    expect(canTransition('UNDER_SCRUTINY', 'DISCREPANCY_RAISED', 'RO_OFFICER')).toBe(true);
    expect(canTransition('DISCREPANCY_RAISED', 'UNDER_SCRUTINY', 'INSTITUTION_USER')).toBe(true);
  });

  it('supports renewal and release paths', () => {
    expect(canTransition('ACTIVE', 'RENEWAL_PENDING', 'INSTITUTION_USER')).toBe(true);
    expect(canTransition('RENEWAL_PENDING', 'RENEWED', 'SYSTEM')).toBe(true);
    expect(canTransition('ACTIVE', 'RELEASE_REQUESTED', 'INSTITUTION_USER')).toBe(true);
    expect(canTransition('RELEASE_REQUESTED', 'RELEASE_RECOMMENDED', 'BUREAU_OFFICER')).toBe(true);
    expect(canTransition('RELEASE_RECOMMENDED', 'RELEASE_APPROVED', 'COMPETENT_AUTHORITY')).toBe(
      true,
    );
    expect(canTransition('RELEASE_RECOMMENDED', 'RELEASE_REJECTED', 'COMPETENT_AUTHORITY')).toBe(
      true,
    );
    expect(canTransition('RELEASE_REJECTED', 'ACTIVE', 'SYSTEM')).toBe(true);
    expect(canTransition('RELEASE_APPROVED', 'RELEASED', 'FINANCE_OFFICER')).toBe(true);
  });

  it('lets any pre-ACTIVE state (except DRAFT) be rejected, but not ACTIVE ones', () => {
    for (const s of ['SUBMITTED', 'UNDER_SCRUTINY', 'BANK_CONFIRMATION_PENDING'] as const) {
      expect(canTransition(s, 'REJECTED', 'RO_OFFICER')).toBe(true);
    }
    expect(canTransition('ACTIVE', 'REJECTED')).toBe(false);
    expect(isPreActive('ACTIVE')).toBe(false);
  });

  it('rejects illegal jumps and wrong actors', () => {
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('SUBMITTED', 'UNDER_SCRUTINY', 'INSTITUTION_USER')).toBe(false);
    expect(canTransition('RELEASE_RECOMMENDED', 'RELEASE_APPROVED', 'SYS_ADMIN')).toBe(false);
    expect(canTransition('RELEASE_APPROVED', 'RELEASED', 'COMPETENT_AUTHORITY')).toBe(false);
    expect(() => assertTransition('DRAFT', 'RELEASED', 'SYSTEM')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('SUBMITTED', 'UNDER_SCRUTINY', 'BANK_OFFICER')).toThrow(
      /may not move/,
    );
  });

  it('has no transitions out of terminal states', () => {
    for (const s of TERMINAL_STATES) expect(nextStates(s)).toEqual([]);
  });

  it('only references known states and has no duplicate edges', () => {
    const edges = new Set<string>();
    for (const t of TRANSITIONS) {
      expect(LIFECYCLE_STATUSES).toContain(t.from);
      expect(LIFECYCLE_STATUSES).toContain(t.to);
      const key = `${t.from}->${t.to}`;
      expect(edges.has(key)).toBe(false);
      edges.add(key);
    }
  });

  it('makes every state reachable from DRAFT', () => {
    const seen = new Set<string>(['DRAFT']);
    const queue = ['DRAFT'];
    while (queue.length) {
      const s = queue.shift()!;
      for (const t of TRANSITIONS.filter((x) => x.from === s)) {
        if (!seen.has(t.to)) {
          seen.add(t.to);
          queue.push(t.to);
        }
      }
    }
    expect([...seen].sort()).toEqual([...LIFECYCLE_STATUSES].sort());
  });
});
