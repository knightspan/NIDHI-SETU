import { z } from 'zod';
import { RELEASE_STATUSES, type ReleaseStatus } from '../enums.js';
import { isoDate } from '../fields.js';
import type { ReleaseCheckCode } from '../rules.js';

export const RequestReleaseSchema = z.object({
  reason: z.string().trim().min(10, 'Explain why the deposit should be released').max(2000),
});
export type RequestReleaseInput = z.infer<typeof RequestReleaseSchema>;

export const ReleaseDecisionSchema = z.object({ note: z.string().trim().min(3).max(2000) });
export type ReleaseDecisionInput = z.infer<typeof ReleaseDecisionSchema>;

/** Finance records how the deposit was discharged outside the portal (the portal never moves money). */
export const ExecuteReleaseSchema = z.object({
  executionRef: z.string().trim().min(3).max(100),
  executionDate: isoDate,
  note: z.string().trim().max(2000).optional(),
});
export type ExecuteReleaseInput = z.infer<typeof ExecuteReleaseSchema>;

export const ReleaseListQuerySchema = z.object({
  status: z.enum(RELEASE_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ReleaseListQuery = z.infer<typeof ReleaseListQuerySchema>;

export interface ReleaseChecklistItem {
  code: ReleaseCheckCode;
  passed: boolean;
  detail: string;
}

export interface ReleaseView {
  id: string;
  instrumentId: string;
  refNo: string;
  institutionName: string;
  amount: string | null;
  reason: string;
  status: ReleaseStatus;
  checklist: ReleaseChecklistItem[];
  checklistPassed: boolean;
  requestedBy: string | null;
  requestedAt: string;
  recommendedBy: string | null;
  recommendedById: string | null;
  recommendedAt: string | null;
  recommendationNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executionRef: string | null;
  executionDate: string | null;
  executedBy: string | null;
  executedAt: string | null;
}
