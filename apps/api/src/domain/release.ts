import type { ReleaseCheckCode, ReleasePreconditionsRule } from '@nidhisetu/shared';
import { addMonths, toIso } from './dates.js';
import { SegregationOfDutiesError } from './errors.js';

export interface ReleaseContext {
  unresolvedDiscrepancies: number;
  fullyBankConfirmed: boolean;
  hasNoc: boolean;
  /** A replacement for this instrument is in progress (submitted but not active). */
  replacementInFlight: boolean;
  activatedAt: Date | null;
  today: Date;
  /** Institution no longer needs this deposit: exempt, or its other live deposits still meet the requirement. */
  requirement: { exempt: boolean; required: number; otherHeld: number };
}

export interface ChecklistItem {
  code: ReleaseCheckCode;
  passed: boolean;
  detail: string;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Evaluates the configurable release preconditions (Section 7 · cap 6). Disabled checks are omitted. */
export function evaluateReleaseChecklist(
  ctx: ReleaseContext,
  rule: ReleasePreconditionsRule,
): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const check of rule.checks) {
    if (!check.enabled) continue;
    switch (check.code) {
      case 'NO_OPEN_DISCREPANCIES':
        out.push({
          code: check.code,
          passed: ctx.unresolvedDiscrepancies === 0,
          detail:
            ctx.unresolvedDiscrepancies === 0
              ? 'No open discrepancies'
              : `${ctx.unresolvedDiscrepancies} discrepanc${ctx.unresolvedDiscrepancies === 1 ? 'y is' : 'ies are'} still open`,
        });
        break;
      case 'BANK_CONFIRMED':
        out.push({
          code: check.code,
          passed: ctx.fullyBankConfirmed,
          detail: ctx.fullyBankConfirmed
            ? 'All bank-confirmable fields confirmed by the bank'
            : 'Bank confirmation incomplete',
        });
        break;
      case 'NOC_UPLOADED':
        out.push({
          code: check.code,
          passed: ctx.hasNoc,
          detail: ctx.hasNoc
            ? 'No-objection certificate on file'
            : 'Upload a no-objection certificate (NOC)',
        });
        break;
      case 'NO_PENDING_RENEWAL':
        out.push({
          code: check.code,
          passed: !ctx.replacementInFlight,
          detail: ctx.replacementInFlight
            ? 'A replacement for this deposit is still being processed'
            : 'No renewal in progress',
        });
        break;
      case 'MIN_HOLDING_PERIOD': {
        const months = check.months ?? 0;
        const due = ctx.activatedAt ? addMonths(ctx.activatedAt, months) : null;
        const passed = !!due && due <= ctx.today;
        out.push({
          code: check.code,
          passed,
          detail: due
            ? passed
              ? `Held for at least ${months} month(s)`
              : `Must be held until ${toIso(due)} (${months} month minimum)`
            : 'Instrument was never active',
        });
        break;
      }
      case 'DEPOSIT_NOT_REQUIRED_OR_REPLACED': {
        const { exempt, required, otherHeld } = ctx.requirement;
        const passed = exempt || otherHeld >= required;
        out.push({
          code: check.code,
          passed,
          detail: exempt
            ? 'Institution is exempt from the deposit requirement'
            : passed
              ? `Other deposits (${inr(otherHeld)}) still cover the requirement (${inr(required)})`
              : `Releasing would leave ${inr(otherHeld)} against a requirement of ${inr(required)}`,
        });
        break;
      }
    }
  }
  return out;
}

export function checklistPassed(items: readonly ChecklistItem[]): boolean {
  return items.every((i) => i.passed);
}

/**
 * Maker-checker (Section 5): the person who recommends a release (maker) can never approve it
 * (checker), and nobody can approve their own request.
 */
export function assertMakerChecker(
  r: { requestedById: string; recommendedById: string | null },
  approverId: string,
): void {
  if (!r.recommendedById)
    throw new SegregationOfDutiesError('A release must be recommended before it can be approved');
  if (r.recommendedById === approverId) {
    throw new SegregationOfDutiesError(
      'Maker-checker: the officer who recommended this release cannot approve it',
    );
  }
  if (r.requestedById === approverId) {
    throw new SegregationOfDutiesError(
      'Maker-checker: the requester cannot approve their own release',
    );
  }
}
