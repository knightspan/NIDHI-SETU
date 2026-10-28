import { z } from 'zod';
import {
  BANK_REQUEST_STATUSES,
  type BankChannel,
  type BankRequestPurpose,
  type BankRequestStatus,
} from '../enums.js';
import { isoDate } from '../fields.js';

/** The confirmations a bank gives (Section 3.2), plus the principal amount. */
export const BankResponseSchema = z
  .object({
    exists: z.boolean(),
    lienMarked: z.boolean().nullable(),
    maturityDate: isoDate.nullable(),
    autoRenewal: z.boolean().nullable(),
    amount: z.coerce.number().positive().nullable().optional(),
    remarks: z.string().trim().max(2000).optional(),
    reference: z.string().trim().max(100).optional(),
  })
  .refine(
    (r) =>
      !r.exists || (r.lienMarked !== null && r.maturityDate !== null && r.autoRenewal !== null),
    {
      message: 'Confirm lien, maturity date and auto-renewal for an existing FDR',
      path: ['lienMarked'],
    },
  );
export type BankResponse = z.infer<typeof BankResponseSchema>;
export type BankResponseInput = z.input<typeof BankResponseSchema>;

export const BankRequestListQuerySchema = z.object({
  status: z.enum(BANK_REQUEST_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type BankRequestListQuery = z.infer<typeof BankRequestListQuerySchema>;

/** What AICTE holds about the instrument when it asks the bank (shown to the bank officer). */
export interface BankSnapshot {
  refNo: string;
  institutionName: string;
  fdrNumber: string | null;
  ifsc: string | null;
  branch: string | null;
  amount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  depositorNames: string | null;
  lienMarked: boolean;
  autoRenewal: boolean;
}

export interface BankRequestView {
  id: string;
  instrumentId: string;
  /** INITIAL confirmation or a REATTESTATION of an active deposit. */
  purpose: BankRequestPurpose;
  reason: string | null;
  bankCode: string;
  bankName: string;
  channel: BankChannel;
  status: BankRequestStatus;
  snapshot: BankSnapshot;
  response: BankResponse | null;
  requestedBy: string | null;
  respondedBy: string | null;
  createdAt: string;
  slaDueAt: string;
  respondedAt: string | null;
  failureReason: string | null;
  attempts: number;
  letterDocumentId: string | null;
}
