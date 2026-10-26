import { z } from 'zod';

/** Helper: builds a zod enum plus a `{ KEY: 'KEY' }` object from one list. */
function makeEnum<const T extends readonly [string, ...string[]]>(values: T) {
  const obj = Object.fromEntries(values.map((v) => [v, v])) as { [K in T[number]]: K };
  return { values, schema: z.enum(values), ...obj };
}

export const ROLES = [
  'INSTITUTION_USER',
  'RO_OFFICER',
  'BUREAU_OFFICER',
  'COMPETENT_AUTHORITY',
  'FINANCE_OFFICER',
  'BANK_OFFICER',
  'AUDITOR',
  'SYS_ADMIN',
] as const;
export const Role = makeEnum(ROLES);
export type Role = (typeof ROLES)[number];

/** Roles that must use TOTP MFA (all except institutions, for whom it is optional). */
export const MFA_MANDATORY_ROLES: readonly Role[] = ROLES.filter((r) => r !== 'INSTITUTION_USER');

export const INSTRUMENT_TYPES = ['FDR', 'ONLINE_DEPOSIT', 'OTHER'] as const;
export const InstrumentType = makeEnum(INSTRUMENT_TYPES);
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const LIFECYCLE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_SCRUTINY',
  'DISCREPANCY_RAISED',
  'OFFICER_VERIFIED',
  'BANK_CONFIRMATION_PENDING',
  'BANK_CONFIRMED',
  'ACTIVE',
  'RENEWAL_PENDING',
  'RENEWED',
  'RELEASE_REQUESTED',
  'RELEASE_RECOMMENDED',
  'RELEASE_APPROVED',
  'RELEASED',
  'RELEASE_REJECTED',
  'REJECTED',
] as const;
export const LifecycleStatus = makeEnum(LIFECYCLE_STATUSES);
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const VALIDITY_STATUSES = ['VALID', 'EXPIRING_SOON', 'MATURED', 'OVERDUE_RENEWAL'] as const;
export const ValidityStatus = makeEnum(VALIDITY_STATUSES);
export type ValidityStatus = (typeof VALIDITY_STATUSES)[number];

/** Ordered from least to most trusted. */
export const TRUST_LEVELS = [
  'DECLARED',
  'OCR_EXTRACTED',
  'OFFICER_VERIFIED',
  'BANK_CONFIRMED',
] as const;
export const TrustLevel = makeEnum(TRUST_LEVELS);
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const DOCUMENT_TYPES = ['FDR_SCAN', 'BANK_LETTER', 'AFFIDAVIT', 'NOC', 'OTHER'] as const;
export const DocumentType = makeEnum(DOCUMENT_TYPES);
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DISCREPANCY_STATUSES = ['OPEN', 'RESPONDED', 'RESOLVED', 'WAIVED'] as const;
export const DiscrepancyStatus = makeEnum(DISCREPANCY_STATUSES);
export type DiscrepancyStatus = (typeof DISCREPANCY_STATUSES)[number];

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const Severity = makeEnum(SEVERITIES);
export type Severity = (typeof SEVERITIES)[number];

export const BANK_REQUEST_STATUSES = ['PENDING', 'CONFIRMED', 'DENIED', 'FAILED'] as const;
export const BankRequestStatus = makeEnum(BANK_REQUEST_STATUSES);
export type BankRequestStatus = (typeof BANK_REQUEST_STATUSES)[number];

export const BANK_CHANNELS = ['DESK', 'MOCK_API'] as const;
export const BankChannel = makeEnum(BANK_CHANNELS);
export type BankChannel = (typeof BANK_CHANNELS)[number];

export const RELEASE_STATUSES = [
  'REQUESTED',
  'RECOMMENDED',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
] as const;
export const ReleaseStatus = makeEnum(RELEASE_STATUSES);
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RULE_TYPES = [
  'ELIGIBILITY',
  'REQUIRED_AMOUNT',
  'VALIDITY',
  'REMINDER_OFFSETS',
  'ESCALATION_SLA',
  'RELEASE_PRECONDITIONS',
  'DISCREPANCY',
] as const;
export const RuleType = makeEnum(RULE_TYPES);
export type RuleType = (typeof RULE_TYPES)[number];

export const LEGACY_ITEM_STATUSES = ['PENDING_REVIEW', 'CONFIRMED', 'REJECTED'] as const;
export const LegacyItemStatus = makeEnum(LEGACY_ITEM_STATUSES);
export type LegacyItemStatus = (typeof LEGACY_ITEM_STATUSES)[number];

/**
 * Key instrument fields tracked with provenance (Section 3.1).
 * `bankCode` refers to the bank master; dates are ISO `YYYY-MM-DD`; booleans are `"true"`/`"false"`.
 */
export const FIELD_KEYS = [
  'fdrNumber',
  'bankCode',
  'ifsc',
  'amount',
  'issueDate',
  'maturityDate',
  'depositorNames',
  'lienMarked',
  'autoRenewal',
] as const;
export const FieldKey = makeEnum(FIELD_KEYS);
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Programme codes used by the required-amount rule. Fictional, configurable via rules. */
export const PROGRAMME_CODES = [
  'UG_ENGINEERING',
  'PG_ENGINEERING',
  'DIPLOMA',
  'MBA',
  'MCA',
  'PHARMACY',
  'ARCHITECTURE',
  'HOTEL_MANAGEMENT',
] as const;
export const ProgrammeCode = makeEnum(PROGRAMME_CODES);
export type ProgrammeCode = (typeof PROGRAMME_CODES)[number];
