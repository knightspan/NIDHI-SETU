import type { OcrServiceResult } from '../src/domain/ocr-mapping.js';

const MARKER = '%NS-OCR ';

/**
 * Stands in for the OCR service in integration tests. A test embeds the result it wants in the
 * uploaded file (see `ocrPdf`); any other file behaves like an unreachable service.
 */
export class FakeOcrClient {
  extract(file: Buffer): Promise<{ result: OcrServiceResult | null; error: string | null }> {
    const text = file.toString('latin1');
    const at = text.indexOf(MARKER);
    if (at < 0) return Promise.resolve({ result: null, error: 'OCR service unavailable (test)' });
    const json = text.slice(at + MARKER.length, text.indexOf('\n', at));
    return Promise.resolve({ result: JSON.parse(json) as OcrServiceResult, error: null });
  }
}

/** A PDF whose "scan" OCRs to the given fields (confidence 0.95 unless given). */
export function ocrPdf(
  fields: OcrServiceResult['fields'],
  confidence: Record<string, number> = {},
): Buffer {
  const conf = Object.fromEntries(Object.keys(fields).map((k) => [k, confidence[k] ?? 0.95]));
  const result: OcrServiceResult = { fields, confidence: conf, raw_text: '', engine: 'fake' };
  return Buffer.from(`%PDF-1.4\n${MARKER}${JSON.stringify(result)}\n% ${Math.random()}\n%%EOF\n`);
}
