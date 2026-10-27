import { Injectable, Logger } from '@nestjs/common';
import {
  type FieldKey,
  type LegacyBatchView,
  type LegacyConfirmData,
  type LegacyItemView,
  type OcrPreview,
  type ReconciliationReport,
  type ReconciliationRow,
} from '@nidhisetu/shared';
import { unzipSync } from 'fflate';
import { AuditService } from '../audit/audit.service.js';
import { actorOf, type Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { requiredAmount } from '../domain/discrepancy-rules.js';
import { toIso } from '../domain/dates.js';
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  ConflictError,
} from '../domain/errors.js';
import { safeFileName, sniffFileType } from '../domain/file-sniff.js';
import type { Principal } from '../domain/scope.js';
import { DocumentsService, type UploadedFile } from '../documents/documents.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AssertionsService } from '../instruments/assertions.service.js';
import { InstrumentsService, declarationToAssertions } from '../instruments/instruments.service.js';
import { TransitionsService } from '../instruments/transitions.service.js';
import { OcrIngestService } from '../ocr/ocr-ingest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';

const MAX_FILES = 50;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Legacy digitisation (Section 3.4): a Regional Office bulk-uploads scans of the physical FDRs it
 * holds, OCR drafts each record, an officer reviews and confirms, and a reconciliation report lists
 * what is missing, expired, mismatched or duplicated.
 */
@Injectable()
export class LegacyService {
  private readonly logger = new Logger(LegacyService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly ocr: OcrIngestService,
    private readonly instruments: InstrumentsService,
    private readonly assertions: AssertionsService,
    private readonly transitions: TransitionsService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly rules: RulesService,
  ) {}

  private regionOf(p: Principal): string {
    if (p.role !== 'RO_OFFICER' || !p.regionId)
      throw new ForbiddenError('Only regional officers digitise legacy records');
    return p.regionId;
  }

  /** Expands ZIP archives and keeps only PDF / PNG / JPEG files. */
  expand(files: UploadedFile[]): UploadedFile[] {
    const out: UploadedFile[] = [];
    for (const f of files) {
      if (f.buffer.subarray(0, 4).toString('latin1') === 'PK\x03\x04') {
        const entries = unzipSync(new Uint8Array(f.buffer), {
          filter: (e) =>
            !e.name.endsWith('/') &&
            !e.name.startsWith('__MACOSX') &&
            e.originalSize <= MAX_FILE_BYTES,
        });
        for (const [name, data] of Object.entries(entries)) {
          const buffer = Buffer.from(data);
          if (sniffFileType(buffer))
            out.push({ buffer, originalname: safeFileName(name), size: buffer.length });
        }
      } else if (sniffFileType(f.buffer)) {
        out.push(f);
      }
    }
    if (out.length === 0)
      throw new InvalidInputError('No PDF, PNG or JPEG files found in the upload');
    if (out.length > MAX_FILES) throw new InvalidInputError(`At most ${MAX_FILES} files per batch`);
    return out;
  }

  async createBatch(
    p: Principal,
    label: string,
    uploaded: UploadedFile[],
  ): Promise<LegacyBatchView> {
    const regionId = this.regionOf(p);
    const files = this.expand(uploaded);
    const actor = actorOf(p);
    const batchId = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.legacyBatch.create({
        data: {
          regionId,
          uploadedById: p.id,
          label,
          fileCount: files.length,
          createdAt: this.clock.now(),
        },
      });
      for (const f of files) {
        const doc = await this.documents.store(tx, {
          file: f,
          type: 'FDR_SCAN',
          instrumentId: null,
          institutionId: null,
          actor,
        });
        await tx.legacyItem.create({
          data: {
            batchId: batch.id,
            documentId: doc.id,
            fileName: safeFileName(f.originalname),
            ocr: {},
            createdAt: this.clock.now(),
          },
        });
      }
      await this.audit.record(
        {
          actor,
          action: 'legacy.batch_uploaded',
          entityType: 'LegacyBatch',
          entityId: batch.id,
          data: { label, files: files.length },
        },
        tx,
      );
      return batch.id;
    });
    // OCR runs in the background: a page of scans can take a minute.
    void this.processBatch(batchId);
    return this.batch(p, batchId);
  }

  /** OCRs every item that has no result yet. Safe to call repeatedly. */
  async processBatch(batchId: string): Promise<void> {
    if (this.running.has(batchId)) return;
    this.running.add(batchId);
    try {
      const items = await this.prisma.legacyItem.findMany({
        where: { batchId },
        include: { document: true },
      });
      for (const item of items) {
        if (item.ocrError || Object.keys(item.ocr as object).length > 0) continue;
        try {
          const plain = await this.documents.readPlain(item.document);
          const { preview, error } = await this.ocr.preview(
            plain,
            item.fileName,
            item.document.mimeType,
          );
          await this.prisma.legacyItem.update({
            where: { id: item.id },
            data: preview ? { ocr: { ...preview } } : { ocrError: error ?? 'OCR failed' },
          });
        } catch (e) {
          await this.prisma.legacyItem.update({
            where: { id: item.id },
            data: { ocrError: e instanceof Error ? e.message.slice(0, 300) : 'OCR failed' },
          });
        }
      }
    } catch (e) {
      this.logger.error(
        `legacy batch ${batchId} processing failed`,
        e instanceof Error ? e.stack : e,
      );
    } finally {
      this.running.delete(batchId);
    }
  }

  async listBatches(p: Principal): Promise<LegacyBatchView[]> {
    const regionId = this.regionOf(p);
    const batches = await this.prisma.legacyBatch.findMany({
      where: { regionId },
      include: { region: true, items: { select: { status: true, ocr: true, ocrError: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return batches.map((b) => ({
      id: b.id,
      label: b.label,
      regionName: b.region.name,
      fileCount: b.fileCount,
      createdAt: b.createdAt.toISOString(),
      counts: counts(b.items),
    }));
  }

  async batch(p: Principal, id: string): Promise<LegacyBatchView> {
    const regionId = this.regionOf(p);
    const b = await this.prisma.legacyBatch.findFirst({
      where: { id, regionId },
      include: {
        region: true,
        items: {
          include: { document: { select: { mimeType: true } } },
          orderBy: { fileName: 'asc' },
        },
      },
    });
    if (!b) throw new NotFoundError('Batch');
    const institutions = await this.prisma.institution.findMany({
      where: { regionId },
      select: { id: true, name: true, aicteId: true, trustName: true },
    });
    const refs = await this.prisma.instrument.findMany({
      where: { id: { in: b.items.map((i) => i.instrumentId).filter((x): x is string => !!x) } },
      select: { id: true, refNo: true },
    });
    const refOf = new Map(refs.map((r) => [r.id, r.refNo]));
    const items: LegacyItemView[] = b.items.map((i) => {
      const ocr = Object.keys(i.ocr as object).length ? (i.ocr as unknown as OcrPreview) : null;
      return {
        id: i.id,
        fileName: i.fileName,
        documentId: i.documentId,
        mimeType: i.document.mimeType,
        status: i.status,
        ocr,
        ocrError: i.ocrError,
        suggestedInstitution: ocr ? suggestInstitution(ocr, institutions) : null,
        instrumentId: i.instrumentId,
        instrumentRefNo: i.instrumentId ? (refOf.get(i.instrumentId) ?? null) : null,
        reviewedAt: i.reviewedAt?.toISOString() ?? null,
      };
    });
    return {
      id: b.id,
      label: b.label,
      regionName: b.region.name,
      fileCount: b.fileCount,
      createdAt: b.createdAt.toISOString(),
      counts: counts(b.items),
      items,
    };
  }

  private async item(p: Principal, id: string) {
    const regionId = this.regionOf(p);
    const item = await this.prisma.legacyItem.findFirst({
      where: { id, batch: { regionId } },
      include: { document: true },
    });
    if (!item) throw new NotFoundError('Legacy item');
    if (item.status !== 'PENDING_REVIEW')
      throw new ConflictError('This item has already been reviewed');
    return item;
  }

  /**
   * The officer confirms the reviewed values against the physical original. Creates a legacy
   * instrument with OCR_EXTRACTED (scan) and OFFICER_VERIFIED (review) assertions, attaches the scan
   * and puts it under scrutiny, ready for bank confirmation.
   */
  async confirm(
    p: Principal,
    id: string,
    input: LegacyConfirmData,
  ): Promise<{ instrumentId: string; refNo: string }> {
    const item = await this.item(p, id);
    const inst = await this.prisma.institution.findFirst({
      where: { id: input.institutionId, regionId: p.regionId! },
    });
    if (!inst) throw new InvalidInputError('Choose an institution in your region');
    const actor: Actor = actorOf(p);
    const ocr = Object.keys(item.ocr as object).length ? (item.ocr as unknown as OcrPreview) : null;
    const now = this.clock.now();
    const result = await this.prisma.$transaction(async (tx) => {
      const refNo = await this.instruments.nextRefNo(tx);
      const created = await tx.instrument.create({
        data: {
          refNo,
          type: input.declaration.type,
          institutionId: inst.id,
          branch: input.declaration.branch,
          status: 'DRAFT',
          legacy: true,
          createdById: p.id,
          createdAt: now,
          statusChangedAt: now,
        },
      });
      await tx.statusTransition.create({
        data: {
          instrumentId: created.id,
          from: null,
          to: 'DRAFT',
          action: 'legacy_import',
          actorId: p.id,
          actorRole: p.role,
          at: now,
        },
      });
      await tx.document.update({
        where: { id: item.documentId },
        data: { instrumentId: created.id, institutionId: inst.id },
      });
      if (ocr) {
        await this.assertions.apply(
          tx,
          created.id,
          (Object.entries(ocr.fields) as [FieldKey, string][]).map(([field, value]) => ({
            field,
            value,
            trust: 'OCR_EXTRACTED' as const,
            source: `ocr:${ocr.engine}`,
            confidence: ocr.confidence[field] ?? null,
            evidenceDocumentId: item.documentId,
          })),
          actor,
        );
      }
      await this.assertions.apply(
        tx,
        created.id,
        declarationToAssertions(input.declaration, 'officer (legacy review)').map((a) => ({
          ...a,
          trust: 'OFFICER_VERIFIED' as const,
          evidenceDocumentId: item.documentId,
        })),
        actor,
      );
      const submitted = await this.transitions.transition(
        tx,
        created,
        'SUBMITTED',
        actor,
        'Digitised from the physical original',
      );
      await this.transitions.transition(tx, submitted, 'UNDER_SCRUTINY', actor);
      await tx.legacyItem.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          instrumentId: created.id,
          reviewedById: p.id,
          reviewedAt: now,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'legacy.confirmed',
          entityType: 'LegacyItem',
          entityId: id,
          data: { instrumentId: created.id, refNo },
        },
        tx,
      );
      await this.instruments.afterChange(tx, created.id, actor);
      return { instrumentId: created.id, refNo };
    });
    return result;
  }

  async reject(p: Principal, id: string, note: string): Promise<void> {
    await this.item(p, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.legacyItem.update({
        where: { id },
        data: { status: 'REJECTED', reviewedById: p.id, reviewedAt: this.clock.now() },
      });
      await this.audit.record(
        {
          actor: actorOf(p),
          action: 'legacy.rejected',
          entityType: 'LegacyItem',
          entityId: id,
          data: { note },
        },
        tx,
      );
    });
  }

  /** What the physical-record reconciliation found for the officer's region. */
  async reconciliation(p: Principal): Promise<ReconciliationReport> {
    const regionId = this.regionOf(p);
    const region = await this.prisma.region.findUniqueOrThrow({ where: { id: regionId } });
    const today = this.clock.today();
    const rules = await this.rules.current();
    const rows: ReconciliationRow[] = [];
    const legacyScope: Prisma.InstrumentWhereInput = { legacy: true, institution: { regionId } };

    // Missing: institutions that need a deposit but have none on record.
    const institutions = await this.prisma.institution.findMany({
      where: { regionId },
      include: {
        instruments: {
          where: { status: { notIn: ['DRAFT', 'REJECTED', 'RELEASED', 'RENEWED'] } },
          select: { id: true },
        },
      },
    });
    for (const i of institutions) {
      const req = requiredAmount(
        i,
        rules['eligibility.exemption'],
        rules['amount.required'],
        today,
      );
      if (!req.exempt && i.instruments.length === 0) {
        rows.push({
          kind: 'MISSING',
          institutionId: i.id,
          institutionName: i.name,
          aicteId: i.aicteId,
          instrumentId: null,
          refNo: null,
          detail: `No deposit on record; ₹${req.required.toLocaleString('en-IN')} required`,
        });
      }
    }

    const legacy = await this.prisma.instrument.findMany({
      where: legacyScope,
      include: {
        institution: { select: { name: true, aicteId: true } },
        discrepancies: {
          where: { status: { in: ['OPEN', 'RESPONDED'] } },
          select: { ruleCode: true, description: true },
        },
      },
    });
    for (const i of legacy) {
      const base = {
        institutionId: i.institutionId,
        institutionName: i.institution.name,
        aicteId: i.institution.aicteId,
        instrumentId: i.id,
        refNo: i.refNo,
      };
      if (
        i.maturityDate &&
        i.maturityDate < today &&
        !['RENEWED', 'RELEASED', 'REJECTED'].includes(i.status)
      ) {
        rows.push({ ...base, kind: 'EXPIRED', detail: `Matured on ${toIso(i.maturityDate)}` });
      }
      const mismatch = i.discrepancies.filter((d) =>
        ['FIELD_MISMATCH', 'BANK_DENIED'].includes(d.ruleCode),
      );
      if (i.mismatchCount > 0 || mismatch.length) {
        rows.push({
          ...base,
          kind: 'MISMATCHED',
          detail:
            mismatch[0]?.description ??
            `${i.mismatchCount} field(s) disagree between scan and review`,
        });
      }
      const dup = i.discrepancies.filter((d) =>
        ['DUPLICATE_FDR', 'DUPLICATE_DOCUMENT'].includes(d.ruleCode),
      );
      if (dup.length)
        rows.push({
          ...base,
          kind: 'DUPLICATED',
          detail: dup.map((d) => d.description).join('; '),
        });
    }

    const pending = await this.prisma.legacyItem.findMany({
      where: { status: 'PENDING_REVIEW', batch: { regionId } },
      include: { batch: { select: { label: true } } },
    });
    for (const it of pending) {
      rows.push({
        kind: 'UNREVIEWED',
        institutionId: null,
        institutionName: null,
        aicteId: null,
        instrumentId: null,
        refNo: null,
        detail: `${it.fileName} (batch "${it.batch.label}")${it.ocrError ? ` — OCR: ${it.ocrError}` : ''}`,
      });
    }
    const kinds = ['MISSING', 'EXPIRED', 'MISMATCHED', 'DUPLICATED', 'UNREVIEWED'] as const;
    return {
      regionName: region.name,
      generatedFor: this.clock.todayIso(),
      counts: Object.fromEntries(
        kinds.map((k) => [k, rows.filter((r) => r.kind === k).length]),
      ) as ReconciliationReport['counts'],
      rows,
    };
  }
}

function counts(items: { status: string; ocr: unknown; ocrError: string | null }[]) {
  return {
    pending: items.filter((i) => i.status === 'PENDING_REVIEW').length,
    confirmed: items.filter((i) => i.status === 'CONFIRMED').length,
    rejected: items.filter((i) => i.status === 'REJECTED').length,
    ocrRunning: items.filter((i) => !i.ocrError && Object.keys(i.ocr as object).length === 0)
      .length,
  };
}

const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/\(FICTIONAL\)|\bTRUST\b|\bSOCIETY\b|[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Suggests the institution whose trust or name matches a depositor on the scan. */
export function suggestInstitution(
  ocr: OcrPreview,
  institutions: { id: string; name: string; aicteId: string; trustName: string }[],
): { id: string; name: string; aicteId: string } | null {
  const depositors = (ocr.fields.depositorNames ?? '')
    .split(';')
    .map((n) => norm(n))
    .filter((n) => n && n !== 'AICTE');
  for (const d of depositors) {
    const hits = institutions.filter((i) => {
      const trust = norm(i.trustName);
      const name = norm(i.name);
      return (
        (trust && (trust === d || d.includes(trust))) || (name && (name === d || d.includes(name)))
      );
    });
    if (hits.length === 1)
      return { id: hits[0]!.id, name: hits[0]!.name, aicteId: hits[0]!.aicteId };
  }
  return null;
}
