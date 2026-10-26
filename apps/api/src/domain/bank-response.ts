import { normalizeFieldValue, type BankResponse, type FieldKey } from '@nidhisetu/shared';

export interface HeldValues {
  fdrNumber: string | null;
  bankCode: string | null;
  amount: string | null;
  maturityDate: string | null;
  lienMarked: boolean;
  autoRenewal: boolean;
}

export interface BankOutcome {
  outcome: 'CONFIRMED' | 'DENIED';
  /** Human-readable list of what the bank contradicted. */
  contradictions: string[];
  /** Values to record as BANK_CONFIRMED assertions. */
  assertions: { field: FieldKey; value: string }[];
}

/**
 * Turns a bank's answer into BANK_CONFIRMED assertions and an outcome. The instrument is confirmed
 * only when the FDR exists, the lien is marked for AICTE and nothing the bank says contradicts
 * what AICTE holds.
 */
export function evaluateBankResponse(held: HeldValues, r: BankResponse): BankOutcome {
  if (!r.exists) {
    return {
      outcome: 'DENIED',
      contradictions: [`The bank reports that FDR ${held.fdrNumber ?? '?'} does not exist`],
      assertions: [],
    };
  }
  const assertions: BankOutcome['assertions'] = [];
  const contradictions: string[] = [];
  const put = (field: FieldKey, value: unknown) =>
    assertions.push({ field, value: normalizeFieldValue(field, value) });

  if (held.fdrNumber) put('fdrNumber', held.fdrNumber);
  if (held.bankCode) put('bankCode', held.bankCode);

  put('lienMarked', r.lienMarked);
  if (r.lienMarked === false) contradictions.push('Lien is not marked in favour of AICTE');

  put('maturityDate', r.maturityDate);
  if (
    held.maturityDate &&
    r.maturityDate &&
    normalizeFieldValue('maturityDate', r.maturityDate) !== held.maturityDate
  ) {
    contradictions.push(
      `Maturity date per bank is ${r.maturityDate}, AICTE holds ${held.maturityDate}`,
    );
  }

  put('autoRenewal', r.autoRenewal);
  if (r.autoRenewal !== null && r.autoRenewal !== held.autoRenewal) {
    contradictions.push(`Auto-renewal per bank is ${r.autoRenewal ? 'ON' : 'OFF'}`);
  }

  if (r.amount !== undefined && r.amount !== null) {
    put('amount', r.amount);
    const bankAmount = normalizeFieldValue('amount', r.amount);
    if (held.amount && bankAmount !== held.amount) {
      contradictions.push(`Principal per bank is ${bankAmount}, AICTE holds ${held.amount}`);
    }
  }
  return { outcome: contradictions.length ? 'DENIED' : 'CONFIRMED', contradictions, assertions };
}
