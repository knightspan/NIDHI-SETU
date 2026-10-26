/** Date helpers. Business dates are IST calendar days, stored as UTC-midnight `Date`s. */

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** Calendar date (YYYY-MM-DD) in India for an instant. */
export function istDateIso(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC-midnight Date for an ISO calendar date — the form Prisma returns for @db.Date columns. */
export function dateOnly(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/** Whole days from a to b (b − a), both calendar dates. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((dateOnly(toIso(b)).getTime() - dateOnly(toIso(a)).getTime()) / DAY_MS);
}

export { DAY_MS };
