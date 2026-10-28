import { z } from 'zod';
import {
  COMPOUNDING_FREQUENCIES,
  DOCUMENT_TYPES,
  PROGRAMME_CODES,
  ROLES,
  SEVERITIES,
} from './enums.js';

/**
 * Configurable rule definitions (Section 3.3). Every rule is stored in the DB as versioned JSON;
 * these schemas validate the JSON when an admin saves a new version.
 */

const severity = z.enum(SEVERITIES);
const role = z.enum(ROLES);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

export const EligibilityRuleSchema = z.object({
  /** Institutions at least this many years old are exempt from the deposit (null = no exemption). */
  exemptIfAgeYearsAtLeast: positiveInt.nullable(),
});

export const RequiredAmountRuleSchema = z.object({
  currency: z.literal('INR'),
  /** Required deposit (₹) per programme; an institution's requirement is the sum over its programmes. */
  amountsByProgramme: z.partialRecord(z.enum(PROGRAMME_CODES), nonNegativeInt),
  /** Used when a programme has no entry above. */
  defaultAmount: nonNegativeInt,
});

export const ValidityRuleSchema = z.object({
  /** An instrument becomes EXPIRING_SOON this many days before maturity. */
  expiringSoonDays: positiveInt,
  /** Days after maturity before a missing renewal is OVERDUE_RENEWAL (until then: MATURED). */
  renewalGraceDays: nonNegativeInt,
  /** Minimum tenure (months from issue) the deposit must cover. */
  requiredTenureMonths: positiveInt,
});

export const ReminderRuleSchema = z.object({
  /** Days before maturity at which reminders go out, e.g. [90, 60, 30, 7]. */
  offsetsDays: z.array(positiveInt).min(1),
  recipients: z.array(role).min(1),
});

export const EscalationRuleSchema = z.object({
  /** Days allowed at each stage before the item escalates one level. */
  scrutinyDays: positiveInt,
  discrepancyResponseDays: positiveInt,
  bankConfirmationDays: positiveInt,
  releaseDecisionDays: positiveInt,
  overdueRenewalDays: nonNegativeInt,
  /** Days an institution has to upload the year's AIS once it is requested (TRINETRA tax eye). */
  aisUploadDays: positiveInt.default(30),
  /** Days the competent authority has to decide a forfeiture proposal. */
  forfeitureDecisionDays: positiveInt.default(15),
  /** Escalation ladder; level 1 goes to ladder[0], level 2 to ladder[1], … */
  ladder: z.array(role).min(1),
});

export const RELEASE_CHECK_CODES = [
  'NO_OPEN_DISCREPANCIES',
  'BANK_CONFIRMED',
  'NOC_UPLOADED',
  'NO_PENDING_RENEWAL',
  'MIN_HOLDING_PERIOD',
  'DEPOSIT_NOT_REQUIRED_OR_REPLACED',
] as const;
export type ReleaseCheckCode = (typeof RELEASE_CHECK_CODES)[number];

export const ReleasePreconditionsRuleSchema = z.object({
  checks: z
    .array(
      z.object({
        code: z.enum(RELEASE_CHECK_CODES),
        enabled: z.boolean(),
        /** Used by MIN_HOLDING_PERIOD. */
        months: nonNegativeInt.optional(),
      }),
    )
    .min(1),
});

export const DISCREPANCY_RULE_CODES = [
  'FIELD_MISMATCH',
  'AMOUNT_BELOW_REQUIRED',
  'MATURITY_BEFORE_REQUIRED_END',
  'NOT_JOINT_NAME',
  'LIEN_NOT_MARKED',
  'DUPLICATE_FDR',
  'DUPLICATE_DOCUMENT',
  'INVALID_IFSC',
  'UNKNOWN_BANK',
  'MISSING_DOCUMENT',
] as const;
export type DiscrepancyRuleCode = (typeof DISCREPANCY_RULE_CODES)[number];
/** Code used for discrepancies an officer raises by hand. */
export const MANUAL_DISCREPANCY_CODE = 'MANUAL';
/** Code used when a bank denies or contradicts a confirmation request. */
export const BANK_DENIAL_CODE = 'BANK_DENIED';
/** Raised by the TRINETRA tax eye when bank-reported interest falls short ("trail broken"). */
export const TAX_TRAIL_CODE = 'TAX_TRAIL_BROKEN';
/** Raised by the TRINETRA document eye (maturity math, IFSC master, duplicates). */
export const DOCUMENT_CHECK_CODE = 'DOCUMENT_CHECK_FAILED';

export const DiscrepancyRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        code: z.enum(DISCREPANCY_RULE_CODES),
        enabled: z.boolean(),
        severity,
      }),
    )
    .min(1),
  /** Joint name with AICTE required (NOT_JOINT_NAME). */
  jointNameRequired: z.boolean(),
  /** Document types that must be present on a submitted instrument (MISSING_DOCUMENT). */
  mandatoryDocuments: z.array(z.enum(DOCUMENT_TYPES)),
});

const pct = z.number().min(0).max(100);

/** TRINETRA verification signals (addendum §1, §3). */
export const VerificationRuleSchema = z.object({
  /** A bank confirmation becomes STALE after this many months. */
  bankStaleMonths: positiveInt,
  /** Release / forfeiture approval needs a bank PASS no older than this. */
  gateBankPassMaxAgeDays: positiveInt,
  /** Maturity-math check: allowed difference between computed and printed maturity value. */
  maturityTolerancePct: pct,
  /** Used for banks with no compounding configured. */
  defaultCompounding: z.enum(COMPOUNDING_FREQUENCIES),
  /** Tax heartbeat: bank-reported interest may fall short of expected by at most this much. */
  taxTolerancePct: pct,
  /** Date (MM-DD) after a financial year ends when its AIS is requested. */
  aisRequestMonthDay: z.string().regex(/^\d{2}-\d{2}$/, 'MM-DD'),
  /** At most this many scheduled re-attestation requests per day (spreads the banks' load). */
  reattestationDailyCap: positiveInt.default(200),
});

const credit = z.number().min(0).max(1);

/** Trust score 0–100 (addendum §2). */
export const TrustWeightsRuleSchema = z.object({
  /** Relative weights of field provenance and the three eyes (normalised to 100). */
  weights: z.object({
    provenance: z.number().nonnegative(),
    bank: z.number().nonnegative(),
    tax: z.number().nonnegative(),
    document: z.number().nonnegative(),
  }),
  /** Share of an eye's weight earned by each result. */
  credit: z.object({ PASS: credit, STALE: credit, NOT_AVAILABLE: credit, FAIL: credit }),
  /** A signal's credit decays linearly to `minAgeFactor` over this many months. */
  ageDecayMonths: positiveInt,
  minAgeFactor: credit,
});

/** Risk level LOW / MEDIUM / HIGH from risk points. */
export const RiskWeightsRuleSchema = z.object({
  /** Points when trust is 0 (scaled linearly; trust 100 → 0 points). */
  lowTrust: z.number().nonnegative(),
  /** Points per open HIGH discrepancy (counted up to 3). */
  openHighDiscrepancy: z.number().nonnegative(),
  /** Points per eye whose latest result is FAIL. */
  failedSignal: z.number().nonnegative(),
  nearMaturityDays: positiveInt,
  nearMaturity: z.number().nonnegative(),
  matured: z.number().nonnegative(),
  mediumAt: z.number().positive(),
  highAt: z.number().positive(),
});

/** Rule codes: one row family per code, versioned. */
export const RULE_DEFINITIONS = {
  'eligibility.exemption': { type: 'ELIGIBILITY', schema: EligibilityRuleSchema },
  'amount.required': { type: 'REQUIRED_AMOUNT', schema: RequiredAmountRuleSchema },
  'validity.window': { type: 'VALIDITY', schema: ValidityRuleSchema },
  'reminders.maturity': { type: 'REMINDER_OFFSETS', schema: ReminderRuleSchema },
  'escalation.sla': { type: 'ESCALATION_SLA', schema: EscalationRuleSchema },
  'release.preconditions': {
    type: 'RELEASE_PRECONDITIONS',
    schema: ReleasePreconditionsRuleSchema,
  },
  'discrepancy.rules': { type: 'DISCREPANCY', schema: DiscrepancyRulesSchema },
  'verification.signals': { type: 'VERIFICATION', schema: VerificationRuleSchema },
  'trust.weights': { type: 'TRUST', schema: TrustWeightsRuleSchema },
  'risk.weights': { type: 'RISK', schema: RiskWeightsRuleSchema },
} as const;

export type RuleCode = keyof typeof RULE_DEFINITIONS;
export const RULE_CODES = Object.keys(RULE_DEFINITIONS) as RuleCode[];
export type RuleConfig<C extends RuleCode> = z.infer<(typeof RULE_DEFINITIONS)[C]['schema']>;

export type EligibilityRule = RuleConfig<'eligibility.exemption'>;
export type RequiredAmountRule = RuleConfig<'amount.required'>;
export type ValidityRule = RuleConfig<'validity.window'>;
export type ReminderRule = RuleConfig<'reminders.maturity'>;
export type EscalationRule = RuleConfig<'escalation.sla'>;
export type ReleasePreconditionsRule = RuleConfig<'release.preconditions'>;
export type DiscrepancyRules = RuleConfig<'discrepancy.rules'>;
export type VerificationRule = RuleConfig<'verification.signals'>;
export type TrustWeightsRule = RuleConfig<'trust.weights'>;
export type RiskWeightsRule = RuleConfig<'risk.weights'>;

export function parseRuleConfig<C extends RuleCode>(code: C, config: unknown): RuleConfig<C> {
  return RULE_DEFINITIONS[code].schema.parse(config) as RuleConfig<C>;
}

export const ASSUMPTION_SOURCE = 'ASSUMPTION – verify against AICTE APH 2024-27';

/**
 * Seed values. Every number here is a labelled placeholder, NOT a regulatory value.
 * Admins replace them through the rules UI, which creates a new version.
 */
export const DEFAULT_RULES: { [C in RuleCode]: RuleConfig<C> } = {
  'eligibility.exemption': { exemptIfAgeYearsAtLeast: 10 },
  'amount.required': {
    currency: 'INR',
    amountsByProgramme: {
      UG_ENGINEERING: 1_000_000,
      PG_ENGINEERING: 500_000,
      DIPLOMA: 500_000,
      MBA: 500_000,
      MCA: 500_000,
      PHARMACY: 500_000,
      ARCHITECTURE: 500_000,
      HOTEL_MANAGEMENT: 500_000,
    },
    defaultAmount: 500_000,
  },
  'validity.window': { expiringSoonDays: 90, renewalGraceDays: 15, requiredTenureMonths: 60 },
  'reminders.maturity': {
    offsetsDays: [90, 60, 30, 7],
    recipients: ['INSTITUTION_USER', 'RO_OFFICER'],
  },
  'escalation.sla': {
    scrutinyDays: 7,
    discrepancyResponseDays: 15,
    bankConfirmationDays: 7,
    releaseDecisionDays: 15,
    overdueRenewalDays: 0,
    aisUploadDays: 30,
    forfeitureDecisionDays: 15,
    ladder: ['RO_OFFICER', 'BUREAU_OFFICER', 'COMPETENT_AUTHORITY'],
  },
  'release.preconditions': {
    checks: [
      { code: 'NO_OPEN_DISCREPANCIES', enabled: true },
      { code: 'BANK_CONFIRMED', enabled: true },
      { code: 'NOC_UPLOADED', enabled: true },
      { code: 'NO_PENDING_RENEWAL', enabled: true },
      { code: 'MIN_HOLDING_PERIOD', enabled: false, months: 12 },
      { code: 'DEPOSIT_NOT_REQUIRED_OR_REPLACED', enabled: true },
    ],
  },
  'discrepancy.rules': {
    rules: [
      { code: 'FIELD_MISMATCH', enabled: true, severity: 'MEDIUM' },
      { code: 'AMOUNT_BELOW_REQUIRED', enabled: true, severity: 'HIGH' },
      { code: 'MATURITY_BEFORE_REQUIRED_END', enabled: true, severity: 'MEDIUM' },
      { code: 'NOT_JOINT_NAME', enabled: true, severity: 'HIGH' },
      { code: 'LIEN_NOT_MARKED', enabled: true, severity: 'HIGH' },
      { code: 'DUPLICATE_FDR', enabled: true, severity: 'HIGH' },
      { code: 'DUPLICATE_DOCUMENT', enabled: true, severity: 'HIGH' },
      { code: 'INVALID_IFSC', enabled: true, severity: 'MEDIUM' },
      { code: 'UNKNOWN_BANK', enabled: true, severity: 'MEDIUM' },
      { code: 'MISSING_DOCUMENT', enabled: true, severity: 'MEDIUM' },
    ],
    jointNameRequired: true,
    mandatoryDocuments: ['FDR_SCAN'],
  },
  'verification.signals': {
    bankStaleMonths: 12,
    gateBankPassMaxAgeDays: 30,
    maturityTolerancePct: 1,
    defaultCompounding: 'QUARTERLY',
    taxTolerancePct: 10,
    aisRequestMonthDay: '06-15',
    reattestationDailyCap: 200,
  },
  'trust.weights': {
    weights: { provenance: 40, bank: 30, tax: 15, document: 15 },
    credit: { PASS: 1, STALE: 0.4, NOT_AVAILABLE: 0.5, FAIL: 0 },
    ageDecayMonths: 12,
    minAgeFactor: 0.5,
  },
  'risk.weights': {
    lowTrust: 4,
    openHighDiscrepancy: 3,
    failedSignal: 3,
    nearMaturityDays: 30,
    nearMaturity: 1,
    matured: 2,
    mediumAt: 3,
    highAt: 6,
  },
};
