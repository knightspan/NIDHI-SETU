import {
  isHeld,
  type LifecycleStatus,
  type ValidityRule,
  type ValidityStatus,
} from '@nidhisetu/shared';
import { daysBetween } from './dates.js';

export interface ValidityInput {
  status: LifecycleStatus;
  maturityDate: Date | null;
}

/**
 * Validity is derived from dates and the (demo) clock, separately from the lifecycle status
 * (Section 6.2). Only deposits AICTE currently holds have a validity status.
 *
 *  VALID            maturity more than `expiringSoonDays` away
 *  EXPIRING_SOON    maturity within `expiringSoonDays`
 *  MATURED          maturity reached, and a renewal is in progress or the grace period is running
 *  OVERDUE_RENEWAL  maturity + grace passed with no renewal in progress
 */
export function computeValidity(
  i: ValidityInput,
  today: Date,
  rule: ValidityRule,
): ValidityStatus | null {
  if (!isHeld(i.status) || !i.maturityDate) return null;
  const daysLeft = daysBetween(today, i.maturityDate);
  if (daysLeft > rule.expiringSoonDays) return 'VALID';
  if (daysLeft > 0) return 'EXPIRING_SOON';
  const daysPast = -daysLeft;
  if (i.status === 'RENEWAL_PENDING' || daysPast <= rule.renewalGraceDays) return 'MATURED';
  return 'OVERDUE_RENEWAL';
}
