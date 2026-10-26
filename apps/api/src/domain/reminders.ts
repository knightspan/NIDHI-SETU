import { addDays, daysBetween } from './dates.js';

export interface ReminderCandidate {
  id: string;
  maturityDate: Date;
}

export interface PlannedReminder {
  instrumentId: string;
  offsetDays: number;
  dueDate: Date;
  /** Only the most urgent crossed offset is announced; older ones are recorded silently. */
  notify: boolean;
}

/**
 * Plans maturity reminders (T-90/60/30/7 by default). Idempotent by construction: an offset that
 * already has a reminder row is never planned again (the DB also enforces a unique key).
 * If the clock jumps past several offsets at once, every crossed offset is recorded but only the
 * nearest one is announced, so nobody receives four emails for one instrument on the same day.
 */
export function planReminders(
  candidates: readonly ReminderCandidate[],
  today: Date,
  offsets: readonly number[],
  existing: ReadonlySet<string>,
): PlannedReminder[] {
  const sorted = [...new Set(offsets)].sort((a, b) => a - b);
  const out: PlannedReminder[] = [];
  for (const c of candidates) {
    const daysLeft = daysBetween(today, c.maturityDate);
    if (daysLeft <= 0) continue; // matured: handled by validity / escalation
    const crossed = sorted.filter((o) => daysLeft <= o);
    if (crossed.length === 0) continue;
    const nearest = crossed[0]!;
    for (const o of crossed) {
      if (existing.has(reminderKey(c.id, o))) continue;
      out.push({
        instrumentId: c.id,
        offsetDays: o,
        dueDate: addDays(c.maturityDate, -o),
        notify: o === nearest,
      });
    }
  }
  return out;
}

export function reminderKey(instrumentId: string, offsetDays: number): string {
  return `${instrumentId}:${offsetDays}`;
}
