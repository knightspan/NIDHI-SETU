import { z } from 'zod';
import {
  DOCUMENT_TYPES,
  INSTRUMENT_TYPES,
  LIFECYCLE_STATUSES,
  VALIDITY_STATUSES,
  type DocumentType,
  type FieldKey,
  type InstrumentType,
  type LifecycleStatus,
  type Role,
  type TrustLevel,
  type ValidityStatus,
} from '../enums.js';
import { IFSC_REGEX, isoDate } from '../fields.js';
import type { BankRequestView } from './bank.js';
import type { ReleaseView } from './release.js';
import type { DiscrepancyView } from './scrutiny.js';

/** What an institution declares about an instrument (all become DECLARED assertions). */
export const InstrumentDeclarationSchema = z
  .object({
    type: z.enum(INSTRUMENT_TYPES).default('FDR'),
    bankCode: z.string().trim().toUpperCase().length(4, 'Select a bank'),
    branch: z.string().trim().min(2).max(120),
    ifsc: z.string().trim().toUpperCase().regex(IFSC_REGEX, 'IFSC looks like SBIN0001234'),
    fdrNumber: z
      .string()
      .trim()
      .min(4)
      .max(40)
      .regex(/^[A-Za-z0-9/-]+$/, 'Letters, digits, "/" and "-" only'),
    amount: z.coerce.number().positive().max(1e11),
    issueDate: isoDate,
    maturityDate: isoDate,
    depositorNames: z.array(z.string().trim().min(2).max(160)).min(1).max(5),
    lienMarked: z.boolean(),
    autoRenewal: z.boolean(),
  })
  .refine((d) => d.maturityDate > d.issueDate, {
    message: 'Maturity must be after the issue date',
    path: ['maturityDate'],
  });
export type InstrumentDeclaration = z.infer<typeof InstrumentDeclarationSchema>;
export type InstrumentDeclarationInput = z.input<typeof InstrumentDeclarationSchema>;

export const InstrumentListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z
    .union([z.enum(LIFECYCLE_STATUSES), z.array(z.enum(LIFECYCLE_STATUSES))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  validity: z.enum(VALIDITY_STATUSES).optional(),
  regionId: z.uuid().optional(),
  bankCode: z.string().length(4).optional(),
  institutionId: z.uuid().optional(),
  maturityFrom: isoDate.optional(),
  maturityTo: isoDate.optional(),
  mismatch: z.enum(['true', 'false']).optional(),
  legacy: z.enum(['true', 'false']).optional(),
  queue: z.enum(['scrutiny', 'bank', 'renewal', 'release']).optional(),
  sort: z.enum(['maturityDate', 'updatedAt', 'amount', 'trustScore', 'refNo']).default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type InstrumentListQuery = z.infer<typeof InstrumentListQuerySchema>;

export const UploadDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
});

// ─── Response shapes (shared so the web app is typed) ────────────────────────

export interface InstrumentSummary {
  id: string;
  refNo: string;
  type: InstrumentType;
  status: LifecycleStatus;
  validityStatus: ValidityStatus | null;
  institution: { id: string; name: string; aicteId: string; regionName: string };
  bankCode: string | null;
  bankName: string | null;
  fdrNumber: string | null;
  amount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  trustScore: number;
  mismatchCount: number;
  openDiscrepancies: number;
  legacy: boolean;
  replacesInstrumentId: string | null;
  updatedAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AssertionView {
  id: string;
  value: string;
  trust: TrustLevel;
  source: string | null;
  confidence: number | null;
  actorName: string | null;
  createdAt: string;
  evidenceDocumentId: string | null;
}

export interface FieldView {
  field: FieldKey;
  effectiveValue: string | null;
  effectiveTrust: TrustLevel | null;
  mismatch: boolean;
  history: AssertionView[];
}

export interface DocumentView {
  id: string;
  type: DocumentType;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  version: number;
  supersededBy: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface TransitionView {
  from: LifecycleStatus | null;
  to: LifecycleStatus;
  action: string;
  actorName: string | null;
  actorRole: Role | 'SYSTEM';
  note: string | null;
  at: string;
}

export interface InstrumentDetail extends InstrumentSummary {
  branch: string | null;
  ifsc: string | null;
  depositorNames: string | null;
  jointName: boolean;
  lienMarked: boolean;
  autoRenewal: boolean;
  submittedAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  institutionDetail: {
    trustName: string;
    state: string;
    yearEstablished: number;
    programmes: string[];
    regionId: string;
  };
  fields: FieldView[];
  documents: DocumentView[];
  transitions: TransitionView[];
  chain: {
    id: string;
    refNo: string;
    status: LifecycleStatus;
    maturityDate: string | null;
    amount: string | null;
  }[];
  replacedBy: { id: string; refNo: string; status: LifecycleStatus } | null;
  discrepancies: DiscrepancyView[];
  bankRequests: BankRequestView[];
  releases: ReleaseView[];
  /** Actions the current user may take right now (computed by the API). */
  allowedActions: string[];
}
