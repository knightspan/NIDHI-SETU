import type { EscalationRule, Role } from '@nidhisetu/shared';
import { daysBetween } from './dates.js';

export const ESCALATION_TYPES = [
  'INSTRUMENT_SCRUTINY',
  'DISCREPANCY',
  'BANK_REQUEST',
  'RELEASE',
  'OVERDUE_RENEWAL',
  'AIS_UPLOAD',
  'FORFEITURE',
] as const;
export type EscalationType = (typeof ESCALATION_TYPES)[number];

/** Climb interval for items whose SLA is 0 days (e.g. overdue renewals). */
export const ZERO_SLA_STEP_DAYS = 7;

/** Something with a deadline that may be missed. */
export interface Escalatable {
  type: EscalationType;
  entityId: string;
  instrumentId: string;
  /** When the SLA clock started (the deadline is start + SLA days). */
  since: Date;
  label: string;
}

export interface PlannedEscalation {
  type: EscalationType;
  entityId: string;
  instrumentId: string;
  level: number;
  toRole: Role;
  reason: string;
}

export function slaDaysFor(type: EscalationType, sla: EscalationRule): number {
  switch (type) {
    case 'INSTRUMENT_SCRUTINY':
      return sla.scrutinyDays;
    case 'DISCREPANCY':
      return sla.discrepancyResponseDays;
    case 'BANK_REQUEST':
      return sla.bankConfirmationDays;
    case 'RELEASE':
      return sla.releaseDecisionDays;
    case 'OVERDUE_RENEWAL':
      return sla.overdueRenewalDays;
    case 'AIS_UPLOAD':
      return sla.aisUploadDays;
    case 'FORFEITURE':
      return sla.forfeitureDecisionDays;
  }
}

/**
 * Escalation level reached: level 1 when the SLA is missed, then one more level for every further
 * SLA period (weekly for 0-day SLAs), capped at the ladder length. Level n goes to ladder[n-1].
 */
export function escalationLevel(
  type: EscalationType,
  since: Date,
  today: Date,
  sla: EscalationRule,
): number {
  const slaDays = slaDaysFor(type, sla);
  const overdue = daysBetween(since, today) - slaDays;
  if (overdue < 0 || (overdue === 0 && slaDays > 0)) return 0;
  // A 0-day SLA escalates immediately, then climbs weekly rather than daily.
  const step = slaDays > 0 ? slaDays : ZERO_SLA_STEP_DAYS;
  return Math.min(sla.ladder.length, 1 + Math.floor(overdue / step));
}

/** All levels reached but not yet recorded (idempotent: `existing` holds "type:entity:level"). */
export function planEscalations(
  items: readonly Escalatable[],
  today: Date,
  sla: EscalationRule,
  existing: ReadonlySet<string>,
): PlannedEscalation[] {
  const out: PlannedEscalation[] = [];
  for (const i of items) {
    const level = escalationLevel(i.type, i.since, today, sla);
    for (let l = 1; l <= level; l++) {
      if (existing.has(escalationKey(i.type, i.entityId, l))) continue;
      out.push({
        type: i.type,
        entityId: i.entityId,
        instrumentId: i.instrumentId,
        level: l,
        toRole: sla.ladder[l - 1]!,
        reason: `${i.label} — SLA of ${slaDaysFor(i.type, sla)} day(s) missed (level ${l})`,
      });
    }
  }
  return out;
}

export function escalationKey(type: string, entityId: string, level: number): string {
  return `${type}:${entityId}:${level}`;
}
