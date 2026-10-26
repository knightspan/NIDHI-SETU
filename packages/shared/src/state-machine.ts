import type { LifecycleStatus, Role } from './enums.js';

/** Actor allowed to trigger a transition. `SYSTEM` = background jobs / automatic follow-ups. */
export type TransitionActor = Role | 'SYSTEM';

export interface TransitionDef {
  from: LifecycleStatus;
  to: LifecycleStatus;
  action: TransitionAction;
  actors: readonly TransitionActor[];
}

export const TRANSITION_ACTIONS = [
  'submit',
  'begin_scrutiny',
  'raise_discrepancy',
  'respond_discrepancy',
  'verify',
  'request_bank_confirmation',
  'bank_confirm',
  'bank_deny',
  'activate',
  'start_renewal',
  'complete_renewal',
  'cancel_renewal',
  'request_release',
  'recommend_release',
  'decline_release',
  'approve_release',
  'reject_release',
  'reinstate',
  'execute_release',
  'reject',
] as const;
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

/** States before an instrument becomes ACTIVE; any of them can be rejected outright. */
export const PRE_ACTIVE_STATES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_SCRUTINY',
  'DISCREPANCY_RAISED',
  'OFFICER_VERIFIED',
  'BANK_CONFIRMATION_PENDING',
  'BANK_CONFIRMED',
] as const satisfies readonly LifecycleStatus[];

/** Terminal states: nothing moves out of these. */
export const TERMINAL_STATES = [
  'RENEWED',
  'RELEASED',
  'REJECTED',
] as const satisfies readonly LifecycleStatus[];

/** States in which the instrument counts as a live security deposit held by AICTE. */
export const HELD_STATES = [
  'ACTIVE',
  'RENEWAL_PENDING',
  'RELEASE_REQUESTED',
  'RELEASE_RECOMMENDED',
  'RELEASE_APPROVED',
] as const satisfies readonly LifecycleStatus[];

const OFFICERS = ['RO_OFFICER'] as const;

/**
 * The lifecycle state machine (Section 6.2), defined once and enforced by the API.
 *
 * Additions to the brief, recorded in docs/DECISIONS.md (D-012):
 *  - BANK_CONFIRMATION_PENDING → UNDER_SCRUTINY when the bank denies or contradicts a field.
 *  - RENEWAL_PENDING → ACTIVE when the replacement instrument is rejected.
 *  - RELEASE_REQUESTED → RELEASE_REJECTED when the officer declines to recommend.
 */
export const TRANSITIONS: readonly TransitionDef[] = [
  { from: 'DRAFT', to: 'SUBMITTED', action: 'submit', actors: ['INSTITUTION_USER', 'RO_OFFICER'] },
  { from: 'SUBMITTED', to: 'UNDER_SCRUTINY', action: 'begin_scrutiny', actors: OFFICERS },
  {
    from: 'UNDER_SCRUTINY',
    to: 'DISCREPANCY_RAISED',
    action: 'raise_discrepancy',
    actors: OFFICERS,
  },
  {
    from: 'DISCREPANCY_RAISED',
    to: 'UNDER_SCRUTINY',
    action: 'respond_discrepancy',
    actors: ['INSTITUTION_USER'],
  },
  { from: 'UNDER_SCRUTINY', to: 'OFFICER_VERIFIED', action: 'verify', actors: OFFICERS },
  {
    from: 'OFFICER_VERIFIED',
    to: 'BANK_CONFIRMATION_PENDING',
    action: 'request_bank_confirmation',
    actors: OFFICERS,
  },
  {
    from: 'BANK_CONFIRMATION_PENDING',
    to: 'BANK_CONFIRMED',
    action: 'bank_confirm',
    actors: ['BANK_OFFICER', 'SYSTEM'],
  },
  {
    from: 'BANK_CONFIRMATION_PENDING',
    to: 'UNDER_SCRUTINY',
    action: 'bank_deny',
    actors: ['BANK_OFFICER', 'SYSTEM'],
  },
  { from: 'BANK_CONFIRMED', to: 'ACTIVE', action: 'activate', actors: ['SYSTEM'] },
  {
    from: 'ACTIVE',
    to: 'RENEWAL_PENDING',
    action: 'start_renewal',
    actors: ['INSTITUTION_USER', 'SYSTEM'],
  },
  { from: 'RENEWAL_PENDING', to: 'RENEWED', action: 'complete_renewal', actors: ['SYSTEM'] },
  { from: 'RENEWAL_PENDING', to: 'ACTIVE', action: 'cancel_renewal', actors: ['SYSTEM'] },
  {
    from: 'ACTIVE',
    to: 'RELEASE_REQUESTED',
    action: 'request_release',
    actors: ['INSTITUTION_USER'],
  },
  {
    from: 'RELEASE_REQUESTED',
    to: 'RELEASE_RECOMMENDED',
    action: 'recommend_release',
    actors: ['RO_OFFICER', 'BUREAU_OFFICER'],
  },
  {
    from: 'RELEASE_REQUESTED',
    to: 'RELEASE_REJECTED',
    action: 'decline_release',
    actors: ['RO_OFFICER', 'BUREAU_OFFICER'],
  },
  {
    from: 'RELEASE_RECOMMENDED',
    to: 'RELEASE_APPROVED',
    action: 'approve_release',
    actors: ['COMPETENT_AUTHORITY'],
  },
  {
    from: 'RELEASE_RECOMMENDED',
    to: 'RELEASE_REJECTED',
    action: 'reject_release',
    actors: ['COMPETENT_AUTHORITY'],
  },
  { from: 'RELEASE_REJECTED', to: 'ACTIVE', action: 'reinstate', actors: ['SYSTEM'] },
  {
    from: 'RELEASE_APPROVED',
    to: 'RELEASED',
    action: 'execute_release',
    actors: ['FINANCE_OFFICER'],
  },
  ...PRE_ACTIVE_STATES.filter((s) => s !== 'DRAFT').map((from): TransitionDef => ({
    from,
    to: 'REJECTED',
    action: 'reject',
    actors: OFFICERS,
  })),
];

export function findTransition(
  from: LifecycleStatus,
  to: LifecycleStatus,
): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransition(
  from: LifecycleStatus,
  to: LifecycleStatus,
  actor?: TransitionActor,
): boolean {
  const t = findTransition(from, to);
  if (!t) return false;
  return actor === undefined || t.actors.includes(actor);
}

export function nextStates(from: LifecycleStatus, actor?: TransitionActor): LifecycleStatus[] {
  return TRANSITIONS.filter(
    (t) => t.from === from && (actor === undefined || t.actors.includes(actor)),
  ).map((t) => t.to);
}

export function isTerminal(status: LifecycleStatus): boolean {
  return (TERMINAL_STATES as readonly LifecycleStatus[]).includes(status);
}

export function isPreActive(status: LifecycleStatus): boolean {
  return (PRE_ACTIVE_STATES as readonly LifecycleStatus[]).includes(status);
}

export function isHeld(status: LifecycleStatus): boolean {
  return (HELD_STATES as readonly LifecycleStatus[]).includes(status);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: LifecycleStatus,
    readonly to: LifecycleStatus,
    readonly actor?: TransitionActor,
  ) {
    super(
      findTransition(from, to)
        ? `${actor ?? 'actor'} may not move an instrument from ${from} to ${to}`
        : `Illegal transition ${from} → ${to}`,
    );
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(
  from: LifecycleStatus,
  to: LifecycleStatus,
  actor: TransitionActor,
): TransitionDef {
  const t = findTransition(from, to);
  if (!t || !t.actors.includes(actor)) throw new IllegalTransitionError(from, to, actor);
  return t;
}
