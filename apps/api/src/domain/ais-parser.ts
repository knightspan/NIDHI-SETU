/**
 * AIS (Annual Information Statement) parsing, isolated behind a small interface so the real format
 * can be plugged in without touching the heartbeat logic.
 *
 * ASSUMPTION: the JSON layout below is our reading of the AIS download and has NOT been validated
 * against real AIS JSON from the e-filing portal (docs/KNOWN_LIMITATIONS.md). Fictional sample:
 * apps/api/fixtures/ais/sample-fy2025-26.json.
 *
 *   { "assessee": { "pan": "…", "name": "…" },
 *     "financialYear": "2025-26",
 *     "informationCategories": [
 *       { "category": "Interest from deposit", "infoCode": "SFT-016(TD)",
 *         "entries": [ { "reportedBy": "STATE BANK OF INDIA", "amount": 123456.0 } ] } ] }
 */

export interface AisInterestRow {
  source: string;
  amount: number;
}

export interface ParsedAis {
  pan: string | null;
  fy: string;
  interestFromDeposits: AisInterestRow[];
}

export interface AisParser {
  readonly id: string;
  canParse(json: unknown): boolean;
  parse(json: unknown): ParsedAis;
}

export class AisParseError extends Error {}

const INTEREST_CODES = new Set(['SFT-016(TD)', 'SFT-016(SB)', 'TDS-194A']);
const isInterestFromDeposit = (category: string, code: string) =>
  INTEREST_CODES.has(code.toUpperCase()) || /interest.*deposit|deposit.*interest/i.test(category);

const text = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Parser for the assumed AIS JSON layout (v1). */
export class AisJsonV1Parser implements AisParser {
  readonly id = 'ais-json-v1-assumed';

  canParse(json: unknown): boolean {
    const o = obj(json);
    return !!o && typeof o.financialYear === 'string' && Array.isArray(o.informationCategories);
  }

  parse(json: unknown): ParsedAis {
    if (!this.canParse(json))
      throw new AisParseError('Not an AIS JSON file in the expected format');
    const o = obj(json)!;
    const fy = String(o.financialYear);
    if (!/^\d{4}-\d{2}$/.test(fy)) throw new AisParseError(`Unexpected financial year "${fy}"`);
    const rows: AisInterestRow[] = [];
    for (const c of o.informationCategories as unknown[]) {
      const cat = obj(c);
      if (!cat) continue;
      if (!isInterestFromDeposit(text(cat.category), text(cat.infoCode))) continue;
      for (const e of Array.isArray(cat.entries) ? cat.entries : []) {
        const entry = obj(e);
        const amount = Number(entry?.amount);
        const source = text(entry?.reportedBy).trim();
        if (source && Number.isFinite(amount)) rows.push({ source, amount });
      }
    }
    return {
      pan: (obj(o.assessee)?.pan as string | undefined) ?? null,
      fy,
      interestFromDeposits: rows,
    };
  }
}

/** Registered parsers, tried in order. Add a new one here when the real format is known. */
export const AIS_PARSERS: readonly AisParser[] = [new AisJsonV1Parser()];

export function parseAis(
  json: unknown,
  parsers: readonly AisParser[] = AIS_PARSERS,
): ParsedAis & { parser: string } {
  const p = parsers.find((x) => x.canParse(json));
  if (!p) throw new AisParseError('Unrecognised AIS format');
  return { ...p.parse(json), parser: p.id };
}

const normaliseBank = (s: string) =>
  s
    .toUpperCase()
    .replace(/\b(LIMITED|LTD|THE)\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '');

/** Sums interest per bank code, matching reporting sources to the bank master by name or alias. */
export function interestByBank(
  rows: readonly AisInterestRow[],
  banks: readonly { code: string; name: string; aliases: readonly string[] }[],
): { byBank: Record<string, number>; unmatched: AisInterestRow[] } {
  const byBank: Record<string, number> = {};
  const unmatched: AisInterestRow[] = [];
  for (const r of rows) {
    const src = normaliseBank(r.source);
    const bank = banks.find((b) => [b.name, ...b.aliases].some((n) => normaliseBank(n) === src));
    if (!bank) {
      unmatched.push(r);
      continue;
    }
    byBank[bank.code] = Math.round(((byBank[bank.code] ?? 0) + r.amount) * 100) / 100;
  }
  return { byBank, unmatched };
}
