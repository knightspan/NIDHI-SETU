import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { OcrServiceResult } from '../domain/ocr-mapping.js';

/** HTTP client for the OCR service (`POST /extract`). Failures return null: OCR is advisory. */
@Injectable()
export class OcrClient {
  private readonly logger = new Logger(OcrClient.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async extract(
    file: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<{ result: OcrServiceResult | null; error: string | null }> {
    try {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(file)], { type: mimeType }), fileName);
      const res = await fetch(`${this.config.OCR_URL.replace(/\/+$/, '')}/extract`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const detail = ((await res.json().catch(() => ({}))) as { detail?: string }).detail;
        return {
          result: null,
          error: `OCR service returned ${res.status}${detail ? `: ${detail}` : ''}`,
        };
      }
      return { result: (await res.json()) as OcrServiceResult, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`OCR unavailable: ${msg}`);
      return { result: null, error: `OCR service unavailable (${msg})` };
    }
  }
}
