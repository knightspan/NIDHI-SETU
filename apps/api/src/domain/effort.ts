import { TRUST_TIERS, type TrustTier } from '@nidhisetu/shared';

/**
 * "Reduction in manual tracking effort" (PS outcome). Manual field edits are values a person typed
 * over an existing value (institution re-declarations, officer corrections), recorded in the audit
 * log as `field.edited`. Fewer edits per instrument means the scan / bank data was right first time.
 */
export function manualEditsPerInstrument(
  edits: readonly { instrumentId: string }[],
  instrumentCount: number,
): { edits: number; perInstrument: number; instrumentsEdited: number; median: number } {
  const per = new Map<string, number>();
  for (const e of edits) per.set(e.instrumentId, (per.get(e.instrumentId) ?? 0) + 1);
  const counts = [...per.values()];
  while (counts.length < instrumentCount) counts.push(0);
  counts.sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  const median =
    counts.length === 0
      ? 0
      : counts.length % 2
        ? counts[mid]!
        : (counts[mid - 1]! + counts[mid]!) / 2;
  return {
    edits: edits.length,
    perInstrument: instrumentCount ? Math.round((edits.length / instrumentCount) * 100) / 100 : 0,
    instrumentsEdited: per.size,
    median,
  };
}

export type TrustMixRow = { region: string } & Record<TrustTier, number> & { total: number };

/** Held deposits per region split by trust tier, largest region first. */
export function trustMixByRegion(
  rows: readonly { region: string; tier: TrustTier; count: number }[],
): TrustMixRow[] {
  const by = new Map<string, TrustMixRow>();
  for (const r of rows) {
    const row = by.get(r.region) ?? {
      region: r.region,
      BANK_CONFIRMED: 0,
      OFFICER_VERIFIED: 0,
      UNVERIFIED: 0,
      total: 0,
    };
    row[r.tier] += r.count;
    row.total += r.count;
    by.set(r.region, row);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.region.localeCompare(b.region));
}

export const TRUST_MIX_ORDER: readonly TrustTier[] = TRUST_TIERS;
