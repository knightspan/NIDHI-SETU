import { normalizeFieldValue, type FieldKey, type OcrPreview } from '@nidhisetu/shared';

/** Raw contract returned by the OCR service (Section 8). */
export interface OcrServiceResult {
  fields: {
    fdr_number?: string | null;
    bank_name?: string | null;
    ifsc?: string | null;
    amount?: number | null;
    issue_date?: string | null;
    maturity_date?: string | null;
    depositor_names?: string[] | null;
  };
  confidence: Record<string, number>;
  raw_text: string;
  engine?: string;
  low_confidence?: string[];
}

/** Below this, a value is highlighted for human review (Section 8). */
export const LOW_CONFIDENCE = 0.8;

/**
 * Maps OCR output onto instrument field keys. The bank is resolved against the bank master by name,
 * falling back to the IFSC prefix. Lien / auto-renewal are never inferred from OCR.
 */
export function mapOcr(
  r: OcrServiceResult,
  banks: readonly { code: string; name: string }[],
): OcrPreview {
  const fields: OcrPreview['fields'] = {};
  const confidence: OcrPreview['confidence'] = {};
  const put = (key: FieldKey, raw: unknown, conf: number | undefined) => {
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0))
      return;
    fields[key] = normalizeFieldValue(key, raw);
    confidence[key] = Math.round((conf ?? 0) * 1000) / 1000;
  };
  const f = r.fields;
  put('fdrNumber', f.fdr_number, r.confidence.fdr_number);
  put('ifsc', f.ifsc, r.confidence.ifsc);
  put('amount', f.amount, r.confidence.amount);
  put('issueDate', f.issue_date, r.confidence.issue_date);
  put('maturityDate', f.maturity_date, r.confidence.maturity_date);
  put('depositorNames', f.depositor_names, r.confidence.depositor_names);

  const byName = f.bank_name
    ? banks.find((b) => b.name.toUpperCase() === f.bank_name!.toUpperCase().trim())
    : undefined;
  const byIfsc = fields.ifsc ? banks.find((b) => b.code === fields.ifsc!.slice(0, 4)) : undefined;
  const bank = byName ?? byIfsc;
  if (bank)
    put('bankCode', bank.code, byName ? r.confidence.bank_name : (r.confidence.ifsc ?? 0) * 0.9);

  const lowConfidence = (Object.keys(fields) as FieldKey[]).filter(
    (k) => (confidence[k] ?? 0) < LOW_CONFIDENCE,
  );
  return { engine: r.engine ?? 'unknown', fields, confidence, lowConfidence, rawText: r.raw_text };
}
