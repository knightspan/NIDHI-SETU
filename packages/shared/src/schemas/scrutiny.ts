import { z } from 'zod';
import {
  DISCREPANCY_STATUSES,
  FIELD_KEYS,
  SEVERITIES,
  type DiscrepancyStatus,
  type FieldKey,
  type Severity,
} from '../enums.js';

export const NoteSchema = z.object({
  note: z.string().trim().min(3, 'Add a short note').max(2000),
});
export type NoteInput = z.infer<typeof NoteSchema>;

export const OptionalNoteSchema = z.object({ note: z.string().trim().max(2000).optional() });

/** Officer verifies fields against the original; `value` corrects the effective value if given. */
export const VerifyFieldsSchema = z.object({
  items: z
    .array(z.object({ field: z.enum(FIELD_KEYS), value: z.string().trim().max(200).optional() }))
    .min(1)
    .max(FIELD_KEYS.length),
});
export type VerifyFieldsInput = z.infer<typeof VerifyFieldsSchema>;

export const RaiseDiscrepancySchema = z.object({
  field: z.enum(FIELD_KEYS).nullish(),
  severity: z.enum(SEVERITIES).default('MEDIUM'),
  description: z.string().trim().min(5).max(2000),
  /** Also send the instrument back to the institution (UNDER_SCRUTINY → DISCREPANCY_RAISED). */
  returnToInstitution: z.boolean().default(true),
});
export type RaiseDiscrepancyInput = z.input<typeof RaiseDiscrepancySchema>;
export type RaiseDiscrepancyData = z.output<typeof RaiseDiscrepancySchema>;

export const CommentSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export type CommentInput = z.infer<typeof CommentSchema>;

export const CloseDiscrepancySchema = z.object({
  resolution: z.enum(['RESOLVED', 'WAIVED']),
  note: z.string().trim().min(3).max(2000),
});
export type CloseDiscrepancyInput = z.infer<typeof CloseDiscrepancySchema>;

export const DiscrepancyListQuerySchema = z.object({
  status: z.enum(DISCREPANCY_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
  severity: z.enum(SEVERITIES).optional(),
  ruleCode: z.string().max(40).optional(),
  instrumentId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type DiscrepancyListQuery = z.infer<typeof DiscrepancyListQuerySchema>;

export interface CommentView {
  id: string;
  authorName: string | null;
  authorRole: string;
  body: string;
  createdAt: string;
}

export interface DiscrepancyView {
  id: string;
  instrumentId: string;
  refNo: string;
  institutionName: string;
  ruleCode: string;
  field: FieldKey | null;
  severity: Severity;
  description: string;
  status: DiscrepancyStatus;
  autoRaised: boolean;
  dueAt: string | null;
  createdAt: string;
  respondedAt: string | null;
  resolvedAt: string | null;
  comments: CommentView[];
}
