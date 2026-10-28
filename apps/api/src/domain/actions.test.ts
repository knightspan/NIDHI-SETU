import { describe, expect, it } from 'vitest';
import { allowedActions, type ActionContext } from './actions.js';

const ctx = (
  status: ActionContext['status'],
  extra: Partial<ActionContext> = {},
): ActionContext => ({
  status,
  unresolvedDiscrepancies: 0,
  hasReplacement: false,
  release: null,
  ...extra,
});
const inst = { id: 'i', role: 'INSTITUTION_USER' as const };
const ro = { id: 'r', role: 'RO_OFFICER' as const };

describe('allowedActions', () => {
  it('lets institutions edit, submit and delete drafts only', () => {
    expect(allowedActions(inst, ctx('DRAFT'))).toEqual(['edit', 'delete', 'submit', 'upload']);
    expect(allowedActions(inst, ctx('SUBMITTED'))).toEqual(['upload']);
    expect(allowedActions(inst, ctx('DISCREPANCY_RAISED'))).toEqual(['edit', 'respond', 'upload']);
  });

  it('offers renewal and release on ACTIVE instruments without a replacement', () => {
    expect(allowedActions(inst, ctx('ACTIVE'))).toContain('renew');
    expect(allowedActions(inst, ctx('ACTIVE', { hasReplacement: true }))).not.toContain('renew');
    expect(allowedActions(inst, ctx('RELEASED'))).toEqual([]);
  });

  it('drives the officer through scrutiny', () => {
    expect(allowedActions(ro, ctx('SUBMITTED'))).toEqual(['upload', 'begin_scrutiny', 'reject']);
    expect(allowedActions(ro, ctx('UNDER_SCRUTINY'))).toContain('verify');
    expect(allowedActions(ro, ctx('UNDER_SCRUTINY', { unresolvedDiscrepancies: 2 }))).not.toContain(
      'verify',
    );
    expect(allowedActions(ro, ctx('OFFICER_VERIFIED'))).toContain('send_to_bank');
    expect(allowedActions(ro, ctx('ACTIVE'))).toEqual(['upload', 'reattest', 'propose_forfeiture']);
    expect(allowedActions(ro, { ...ctx('ACTIVE'), hasOpenBankRequest: true })).not.toContain(
      'reattest',
    );
  });

  it('enforces maker-checker for the competent authority', () => {
    const ca = { id: 'ca', role: 'COMPETENT_AUTHORITY' as const };
    expect(
      allowedActions(
        ca,
        ctx('RELEASE_RECOMMENDED', { release: { requestedById: 'x', recommendedById: 'b' } }),
      ),
    ).toEqual(['approve_release', 'reject_release']);
    expect(
      allowedActions(
        ca,
        ctx('RELEASE_RECOMMENDED', { release: { requestedById: 'x', recommendedById: 'ca' } }),
      ),
    ).toEqual([]);
  });

  it('gives finance only execution, and read-only roles nothing', () => {
    expect(allowedActions({ id: 'f', role: 'FINANCE_OFFICER' }, ctx('RELEASE_APPROVED'))).toEqual([
      'execute_release',
    ]);
    expect(allowedActions({ id: 'b', role: 'BUREAU_OFFICER' }, ctx('RELEASE_REQUESTED'))).toEqual([
      'recommend_release',
      'decline_release',
    ]);
    for (const role of ['AUDITOR', 'SYS_ADMIN', 'BANK_OFFICER'] as const) {
      expect(allowedActions({ id: 'x', role }, ctx('ACTIVE'))).toEqual([]);
    }
  });
});
