import { Injectable } from '@nestjs/common';
import type { FieldKey, OcrPreview } from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { mapOcr } from '../domain/ocr-mapping.js';
import type { Document } from '../generated/prisma/client.js';
import { AssertionsService } from '../instruments/assertions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OcrClient } from './ocr.client.js';

/**
 * Turns an uploaded scan into OCR_EXTRACTED assertions (Section 8): OCR is never promoted above
 * that trust level, and every assertion links back to the scan it came from.
 */
@Injectable()
export class OcrIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ocr: OcrClient,
    private readonly assertions: AssertionsService,
    private readonly audit: AuditService,
  ) {}

  async preview(
    file: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<{ preview: OcrPreview | null; error: string | null }> {
    const { result, error } = await this.ocr.extract(file, fileName, mimeType);
    if (!result) return { preview: null, error };
    const banks = await this.prisma.bank.findMany({ select: { code: true, name: true } });
    return { preview: mapOcr(result, banks), error: null };
  }

  /** OCR a stored scan and record its fields against the instrument. Returns the preview (or null). */
  async ingest(
    instrumentId: string,
    doc: Document,
    plain: Buffer,
    actor: Actor,
    afterChange: (instrumentId: string) => Promise<void>,
  ): Promise<OcrPreview | null> {
    const { preview } = await this.preview(plain, doc.originalName, doc.mimeType);
    if (!preview || Object.keys(preview.fields).length === 0) return null;
    await this.prisma.$transaction(async (tx) => {
      await this.assertions.apply(
        tx,
        instrumentId,
        (Object.entries(preview.fields) as [FieldKey, string][]).map(([field, value]) => ({
          field,
          value,
          trust: 'OCR_EXTRACTED' as const,
          source: `ocr:${preview.engine}`,
          confidence: preview.confidence[field] ?? null,
          evidenceDocumentId: doc.id,
        })),
        actor,
      );
      await this.audit.record(
        {
          actor,
          action: 'ocr.extracted',
          entityType: 'Document',
          entityId: doc.id,
          data: {
            instrumentId,
            engine: preview.engine,
            fields: Object.keys(preview.fields),
            lowConfidence: preview.lowConfidence,
          },
        },
        tx,
      );
    });
    await afterChange(instrumentId);
    return preview;
  }
}
