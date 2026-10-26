import { FIELD_KEYS, TRUST_LEVELS, type FieldKey, type TrustLevel } from '@nidhisetu/shared';

/** Minimal view of a FieldAssertion row. */
export interface AssertionLike {
  id?: string;
  field: string;
  value: string;
  trust: TrustLevel;
  createdAt: Date;
  actorId?: string | null;
  source?: string | null;
  confidence?: number | null;
  evidenceDocumentId?: string | null;
}

export interface FieldState {
  field: FieldKey;
  /** Value of the latest assertion at the highest trust level present. */
  effectiveValue: string | null;
  effectiveTrust: TrustLevel | null;
  /** True when the latest assertions of different trust levels disagree. */
  mismatch: boolean;
  /** Latest assertion per trust level. */
  latestByTrust: Partial<Record<TrustLevel, AssertionLike>>;
}

export const TRUST_RANK: Record<TrustLevel, number> = {
  DECLARED: 0,
  OCR_EXTRACTED: 1,
  OFFICER_VERIFIED: 2,
  BANK_CONFIRMED: 3,
};

/** Points a field earns towards the trust score at each level (mismatch or missing = 0). */
export const TRUST_POINTS: Record<TrustLevel, number> = {
  DECLARED: 25,
  OCR_EXTRACTED: 45,
  OFFICER_VERIFIED: 75,
  BANK_CONFIRMED: 100,
};

/** Fields a bank can confirm (Section 3.2: existence → number and bank, lien, maturity, auto-renewal, amount). */
export const BANK_CONFIRMABLE_FIELDS: readonly FieldKey[] = [
  'fdrNumber',
  'bankCode',
  'amount',
  'maturityDate',
  'lienMarked',
  'autoRenewal',
];

export function computeFieldState(
  field: FieldKey,
  assertions: readonly AssertionLike[],
): FieldState {
  const latestByTrust: Partial<Record<TrustLevel, AssertionLike>> = {};
  for (const a of assertions) {
    if (a.field !== field) continue;
    const cur = latestByTrust[a.trust];
    if (!cur || a.createdAt.getTime() >= cur.createdAt.getTime()) latestByTrust[a.trust] = a;
  }
  let effective: AssertionLike | undefined;
  for (const level of [...TRUST_LEVELS].reverse()) {
    if (latestByTrust[level]) {
      effective = latestByTrust[level];
      break;
    }
  }
  const distinct = new Set(
    Object.values(latestByTrust)
      .map((a) => a.value)
      .filter((v) => v !== ''),
  );
  return {
    field,
    effectiveValue: effective?.value ?? null,
    effectiveTrust: effective?.trust ?? null,
    mismatch: distinct.size > 1,
    latestByTrust,
  };
}

export function computeFieldStates(
  assertions: readonly AssertionLike[],
): Record<FieldKey, FieldState> {
  return Object.fromEntries(FIELD_KEYS.map((f) => [f, computeFieldState(f, assertions)])) as Record<
    FieldKey,
    FieldState
  >;
}

/** 0–100 summary of how well-evidenced an instrument's key fields are. */
export function trustScore(states: Record<FieldKey, FieldState>): number {
  let total = 0;
  for (const f of FIELD_KEYS) {
    const s = states[f];
    if (!s.effectiveTrust || s.mismatch) continue;
    total += TRUST_POINTS[s.effectiveTrust];
  }
  return Math.round(total / FIELD_KEYS.length);
}

export function mismatchedFields(states: Record<FieldKey, FieldState>): FieldKey[] {
  return FIELD_KEYS.filter((f) => states[f].mismatch);
}

/** All bank-confirmable fields carry a BANK_CONFIRMED value and nothing disagrees. */
export function isFullyBankConfirmed(states: Record<FieldKey, FieldState>): boolean {
  return BANK_CONFIRMABLE_FIELDS.every(
    (f) => states[f].effectiveTrust === 'BANK_CONFIRMED' && !states[f].mismatch,
  );
}

/** Describes a mismatch for humans: "DECLARED 100000.00 vs OCR_EXTRACTED 10000.00". */
export function describeMismatch(state: FieldState): string {
  return TRUST_LEVELS.filter((t) => state.latestByTrust[t])
    .map((t) => `${t} "${state.latestByTrust[t]!.value}"`)
    .join(' vs ');
}
