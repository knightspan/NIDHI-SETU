import { createHash } from 'node:crypto';
import {
  AICTE_BENEFICIARY,
  IFSC_REGEX,
  type DiscrepancyRuleCode,
  type DiscrepancyRules,
  type DocumentType,
  type EligibilityRule,
  type FieldKey,
  type RequiredAmountRule,
  type Severity,
  type ValidityRule,
} from '@nidhisetu/shared';
import { addMonths, dateOnly, toIso } from './dates.js';
import { describeMismatch, mismatchedFields, type FieldState } from './trust.js';

export interface DiscrepancyContext {
  states: Record<FieldKey, FieldState>;
  institution: { yearEstablished: number; programmes: string[] };
  today: Date;
  rules: {
    eligibility: EligibilityRule;
    amount: RequiredAmountRule;
    validity: ValidityRule;
    discrepancy: DiscrepancyRules;
  };
  /** Sum of the institution's other live deposits (excluding the one this instrument replaces). */
  otherHeldAmount: number;
  /** Instruments of OTHER institutions with the same bank + FDR number. */
  duplicateFdrs: { refNo: string; institutionName: string }[];
  /** Documents on other instruments with the same sha256 as one of ours. */
  duplicateDocuments: { documentType: DocumentType; otherRefNo: string }[];
  knownBankCodes: ReadonlySet<string>;
  documentTypes: ReadonlySet<DocumentType>;
  /** Mandatory-document checks only apply once the instrument has been submitted. */
  submitted: boolean;
}

export interface Finding {
  code: DiscrepancyRuleCode;
  key: string;
  field: FieldKey | null;
  severity: Severity;
  description: string;
}

/** Deposit an institution must hold under the eligibility and amount rules (0 if exempt). */
export function requiredAmount(
  inst: { yearEstablished: number; programmes: string[] },
  eligibility: EligibilityRule,
  amount: RequiredAmountRule,
  today: Date,
): { required: number; exempt: boolean; ageYears: number } {
  const ageYears = today.getUTCFullYear() - inst.yearEstablished;
  if (
    eligibility.exemptIfAgeYearsAtLeast !== null &&
    ageYears >= eligibility.exemptIfAgeYearsAtLeast
  ) {
    return { required: 0, exempt: true, ageYears };
  }
  const required = inst.programmes.reduce(
    (sum, p) =>
      sum +
      (amount.amountsByProgramme[p as keyof typeof amount.amountsByProgramme] ??
        amount.defaultAmount),
    0,
  );
  return { required, exempt: false, ageYears };
}

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Evaluates the configurable discrepancy rules (Section 6.3). Pure: no I/O. */
export function evaluateDiscrepancyRules(ctx: DiscrepancyContext): Finding[] {
  const cfg = new Map(ctx.rules.discrepancy.rules.map((r) => [r.code, r]));
  const out: Finding[] = [];
  const emit = (
    code: DiscrepancyRuleCode,
    keySuffix: string,
    field: FieldKey | null,
    description: string,
  ) => {
    const rule = cfg.get(code);
    if (!rule?.enabled) return;
    out.push({ code, key: `${code}:${keySuffix}`, field, severity: rule.severity, description });
  };
  const v = (f: FieldKey) => ctx.states[f].effectiveValue;

  // 1. Declared vs OCR vs officer vs bank disagreement on any key field.
  for (const f of mismatchedFields(ctx.states)) {
    const s = ctx.states[f];
    const values = Object.values(s.latestByTrust)
      .map((a) => a.value)
      .sort()
      .join('|');
    emit(
      'FIELD_MISMATCH',
      `${f}:${short(values)}`,
      f,
      `Sources disagree on ${f}: ${describeMismatch(s)}`,
    );
  }

  // 2. Amount below the institution's requirement (summed over its live deposits).
  const amount = Number(v('amount'));
  if (Number.isFinite(amount) && v('amount')) {
    const req = requiredAmount(ctx.institution, ctx.rules.eligibility, ctx.rules.amount, ctx.today);
    const total = amount + ctx.otherHeldAmount;
    if (!req.exempt && total < req.required) {
      emit(
        'AMOUNT_BELOW_REQUIRED',
        `${req.required}:${total}`,
        'amount',
        `Deposits total ${inr(total)} but ${inr(req.required)} is required for the institution's programmes`,
      );
    }
  }

  // 3. Maturity earlier than the required validity end.
  const issue = v('issueDate');
  const maturity = v('maturityDate');
  if (
    issue &&
    maturity &&
    /^\d{4}-\d{2}-\d{2}$/.test(issue) &&
    /^\d{4}-\d{2}-\d{2}$/.test(maturity)
  ) {
    const requiredEnd = addMonths(dateOnly(issue), ctx.rules.validity.requiredTenureMonths);
    if (dateOnly(maturity) < requiredEnd) {
      emit(
        'MATURITY_BEFORE_REQUIRED_END',
        `${maturity}:${toIso(requiredEnd)}`,
        'maturityDate',
        `Maturity ${maturity} is before the required validity end ${toIso(requiredEnd)} (${ctx.rules.validity.requiredTenureMonths} months from issue)`,
      );
    }
  }

  // 4. Not in joint name with AICTE.
  const names = v('depositorNames');
  if (ctx.rules.discrepancy.jointNameRequired && names !== null) {
    const joint = names.split(';').some((n) => n.trim() === AICTE_BENEFICIARY);
    if (!joint)
      emit(
        'NOT_JOINT_NAME',
        short(names),
        'depositorNames',
        `Beneficiaries "${names}" do not include AICTE`,
      );
  }

  // 5. Lien not marked in favour of AICTE.
  if (v('lienMarked') === 'false') {
    emit('LIEN_NOT_MARKED', 'lien', 'lienMarked', 'Lien is not marked in favour of AICTE');
  }

  // 6. Same bank + FDR number at another institution: fraud signal.
  for (const d of ctx.duplicateFdrs) {
    emit(
      'DUPLICATE_FDR',
      `${v('bankCode')}:${v('fdrNumber')}:${d.refNo}`,
      'fdrNumber',
      `FDR ${v('fdrNumber')} of ${v('bankCode')} is also declared by ${d.institutionName} (${d.refNo})`,
    );
  }

  // 7. Same document (by hash) used for another instrument.
  for (const d of ctx.duplicateDocuments) {
    emit(
      'DUPLICATE_DOCUMENT',
      `${d.documentType}:${d.otherRefNo}`,
      null,
      `This ${d.documentType} is byte-identical to a document on ${d.otherRefNo}`,
    );
  }

  // 8. IFSC format, and IFSC bank prefix vs declared bank; bank not in the master.
  const ifsc = v('ifsc');
  const bank = v('bankCode');
  if (ifsc && !IFSC_REGEX.test(ifsc)) {
    emit(
      'INVALID_IFSC',
      `format:${ifsc}`,
      'ifsc',
      `IFSC "${ifsc}" is not a valid format (e.g. SBIN0001234)`,
    );
  } else if (ifsc && bank && ifsc.slice(0, 4) !== bank) {
    emit(
      'INVALID_IFSC',
      `prefix:${ifsc}:${bank}`,
      'ifsc',
      `IFSC "${ifsc}" does not belong to bank ${bank}`,
    );
  }
  if (bank && !ctx.knownBankCodes.has(bank)) {
    emit('UNKNOWN_BANK', bank, 'bankCode', `Bank "${bank}" is not in the bank master`);
  }

  // 9. Mandatory documents missing.
  if (ctx.submitted) {
    for (const type of ctx.rules.discrepancy.mandatoryDocuments) {
      if (!ctx.documentTypes.has(type))
        emit('MISSING_DOCUMENT', type, null, `Mandatory document missing: ${type}`);
    }
  }

  return out;
}
