import { isPreActive, isTerminal, type LifecycleStatus, type Role } from '@nidhisetu/shared';

export const INSTRUMENT_ACTIONS = [
  'edit',
  'delete',
  'submit',
  'upload',
  'begin_scrutiny',
  'verify_field',
  'raise_discrepancy',
  'respond',
  'verify',
  'send_to_bank',
  'reject',
  'renew',
  'request_release',
  'recommend_release',
  'decline_release',
  'approve_release',
  'reject_release',
  'execute_release',
] as const;
export type InstrumentAction = (typeof INSTRUMENT_ACTIONS)[number];

export interface ActionContext {
  status: LifecycleStatus;
  /** Unresolved (OPEN or RESPONDED) discrepancies on the instrument. */
  unresolvedDiscrepancies: number;
  /** A replacement instrument already exists. */
  hasReplacement: boolean;
  /** Pending release request, if any. */
  release?: { requestedById: string; recommendedById: string | null } | null;
}

/**
 * Which actions a user may take on an instrument right now. Scope (own institution / region) is
 * checked before this is called; this covers role × state × separation of duties.
 */
export function allowedActions(
  user: { id: string; role: Role },
  ctx: ActionContext,
): InstrumentAction[] {
  const s = ctx.status;
  const out: InstrumentAction[] = [];
  const add = (cond: boolean, ...a: InstrumentAction[]) => cond && out.push(...a);

  switch (user.role) {
    case 'INSTITUTION_USER':
      add(s === 'DRAFT', 'edit', 'delete', 'submit');
      add(s === 'DISCREPANCY_RAISED', 'edit', 'respond');
      add(!isTerminal(s), 'upload');
      add(s === 'ACTIVE' && !ctx.hasReplacement, 'renew', 'request_release');
      break;
    case 'RO_OFFICER':
      add(!isTerminal(s) && s !== 'DRAFT', 'upload');
      add(s === 'SUBMITTED', 'begin_scrutiny');
      add(
        s === 'UNDER_SCRUTINY' || s === 'DISCREPANCY_RAISED',
        'verify_field',
        'raise_discrepancy',
      );
      add(s === 'UNDER_SCRUTINY' && ctx.unresolvedDiscrepancies === 0, 'verify');
      add(s === 'OFFICER_VERIFIED', 'send_to_bank');
      add(isPreActive(s) && s !== 'DRAFT', 'reject');
      add(s === 'RELEASE_REQUESTED', 'recommend_release', 'decline_release');
      break;
    case 'BUREAU_OFFICER':
      add(s === 'RELEASE_REQUESTED', 'recommend_release', 'decline_release');
      break;
    case 'COMPETENT_AUTHORITY':
      // Maker-checker: whoever recommended cannot approve.
      add(
        s === 'RELEASE_RECOMMENDED' && ctx.release?.recommendedById !== user.id,
        'approve_release',
        'reject_release',
      );
      break;
    case 'FINANCE_OFFICER':
      add(s === 'RELEASE_APPROVED', 'execute_release');
      break;
    case 'BANK_OFFICER':
    case 'AUDITOR':
    case 'SYS_ADMIN':
      break;
  }
  return out;
}
