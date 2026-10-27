import { z } from 'zod';
import type { FieldKey, LegacyItemStatus } from '../enums.js';
import { InstrumentDeclarationSchema } from './instrument.js';

/** OCR result mapped onto instrument field keys (values normalised for the declaration form). */
export interface OcrPreview {
  engine: string;
  fields: Partial<Record<FieldKey, string>>;
  confidence: Partial<Record<FieldKey, number>>;
  lowConfidence: FieldKey[];
  rawText: string;
}

export interface LegacyItemView {
  id: string;
  fileName: string;
  documentId: string;
  mimeType: string;
  status: LegacyItemStatus;
  /** null while OCR is still running. */
  ocr: OcrPreview | null;
  ocrError: string | null;
  suggestedInstitution: { id: string; name: string; aicteId: string } | null;
  instrumentId: string | null;
  instrumentRefNo: string | null;
  reviewedAt: string | null;
}

export interface LegacyBatchView {
  id: string;
  label: string;
  regionName: string;
  fileCount: number;
  createdAt: string;
  counts: { pending: number; confirmed: number; rejected: number; ocrRunning: number };
  items?: LegacyItemView[];
}

export const LegacyConfirmSchema = z.object({
  institutionId: z.uuid(),
  declaration: InstrumentDeclarationSchema,
});
export type LegacyConfirmInput = z.input<typeof LegacyConfirmSchema>;
export type LegacyConfirmData = z.output<typeof LegacyConfirmSchema>;

export interface ReconciliationRow {
  kind: 'MISSING' | 'EXPIRED' | 'MISMATCHED' | 'DUPLICATED' | 'UNREVIEWED';
  institutionId: string | null;
  institutionName: string | null;
  aicteId: string | null;
  instrumentId: string | null;
  refNo: string | null;
  detail: string;
}

export interface ReconciliationReport {
  regionName: string;
  generatedFor: string;
  counts: Record<ReconciliationRow['kind'], number>;
  rows: ReconciliationRow[];
}
