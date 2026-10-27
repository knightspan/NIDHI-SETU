import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { DocumentType, OcrPreview } from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { actorOf, type Actor } from '../common/actor.js';
import { open, seal, sha256Hex } from '../common/crypto.js';
import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { ForbiddenError, InvalidInputError, NotFoundError } from '../domain/errors.js';
import { safeFileName, sniffFileType } from '../domain/file-sniff.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import type { Document, Prisma } from '../generated/prisma/client.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { OcrIngestService } from '../ocr/ocr-ingest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter.js';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

interface DownloadClaims {
  sub: string; // user id
  role: string;
  doc: string;
  inline: boolean;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instruments: InstrumentsService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly jwt: JwtService,
    private readonly ocr: OcrIngestService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Validates, encrypts and stores a file, versioning it against earlier files of the same type. */
  async store(
    tx: Prisma.TransactionClient,
    args: {
      file: UploadedFile;
      type: DocumentType;
      instrumentId: string | null;
      institutionId: string | null;
      actor: Actor;
    },
  ): Promise<Document> {
    const { file } = args;
    if (file.size > this.config.DOCUMENT_MAX_MB * 1024 * 1024) {
      throw new InvalidInputError(`File is larger than ${this.config.DOCUMENT_MAX_MB} MB`);
    }
    const mimeType = sniffFileType(file.buffer);
    if (!mimeType) throw new InvalidInputError('Only PDF, PNG or JPEG files are accepted');

    const previous = args.instrumentId
      ? await tx.document.findFirst({
          where: { instrumentId: args.instrumentId, type: args.type },
          orderBy: { version: 'desc' },
        })
      : null;
    const id = randomUUID();
    const storageKey = `documents/${new Date().toISOString().slice(0, 7)}/${id}`;
    const sealed = seal(file.buffer, this.config.DOCUMENT_ENCRYPTION_KEY, storageKey);
    await this.storage.put(storageKey, sealed.ciphertext);

    const doc = await tx.document.create({
      data: {
        id,
        instrumentId: args.instrumentId,
        institutionId: args.institutionId,
        type: args.type,
        storageKey,
        sha256: sha256Hex(file.buffer),
        mimeType,
        size: file.size,
        originalName: safeFileName(file.originalname),
        version: (previous?.version ?? 0) + 1,
        supersedesId: previous?.id ?? null,
        iv: sealed.iv,
        authTag: sealed.authTag,
        uploadedById: args.actor.id ?? '00000000-0000-0000-0000-000000000000',
        createdAt: this.clock.now(),
      },
    });
    await this.audit.record(
      {
        actor: args.actor,
        action: 'document.uploaded',
        entityType: 'Document',
        entityId: doc.id,
        data: {
          instrumentId: args.instrumentId,
          type: args.type,
          sha256: doc.sha256,
          version: doc.version,
          size: doc.size,
        },
      },
      tx,
    );
    return doc;
  }

  /**
   * Upload against an instrument the principal can see and may currently upload to. An FDR scan is
   * also run through OCR (after the upload commits) and its fields recorded as OCR_EXTRACTED.
   */
  async uploadForInstrument(
    p: Principal,
    instrumentId: string,
    type: DocumentType,
    file: UploadedFile,
  ): Promise<{ doc: Document; ocr: OcrPreview | null }> {
    const inst = await this.instruments.getScoped(p, instrumentId);
    if (p.role !== 'BANK_OFFICER') await this.instruments.assertAction(p, inst, 'upload');
    const actor = actorOf(p);
    const doc = await this.prisma.$transaction(async (tx) => {
      const d = await this.store(tx, {
        file,
        type,
        instrumentId,
        institutionId: inst.institutionId,
        actor,
      });
      await this.instruments.afterChange(tx, instrumentId, actor);
      return d;
    });
    const ocr =
      type === 'FDR_SCAN'
        ? await this.ocr.ingest(instrumentId, doc, file.buffer, actor, (id) =>
            this.prisma.$transaction((tx) => this.instruments.afterChange(tx, id, actor)),
          )
        : null;
    return { doc, ocr };
  }

  /** A document is visible when its instrument is visible to the principal. */
  async getScoped(p: Principal, id: string): Promise<Document> {
    const doc = await this.prisma.document.findFirst({
      where: {
        id,
        OR: [
          { instrument: instrumentScope(p) },
          // Legacy batch files not yet attached to an instrument: RO of the batch's region.
          ...(p.role === 'RO_OFFICER' && p.regionId
            ? [{ instrumentId: null, legacyItem: { batch: { regionId: p.regionId } } }]
            : []),
        ],
      },
    });
    if (!doc) throw new NotFoundError('Document');
    return doc;
  }

  /** Issues a short-lived signed URL (Section 7 · cap 2). */
  async signedUrl(
    p: Principal,
    id: string,
    inline: boolean,
  ): Promise<{ url: string; expiresAt: string }> {
    await this.getScoped(p, id);
    const ttl = this.config.DOCUMENT_URL_TTL_SECONDS;
    const claims: DownloadClaims = { sub: p.id, role: p.role, doc: id, inline };
    const token = await this.jwt.signAsync(claims, {
      secret: this.config.JWT_ACCESS_SECRET,
      audience: 'nidhisetu-document',
      expiresIn: ttl,
    });
    return {
      url: `/api/documents/download?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /** Verifies the signed token, decrypts and returns the file. Every download is audited. */
  async download(token: string): Promise<{ doc: Document; body: Buffer; inline: boolean }> {
    let claims: DownloadClaims;
    try {
      claims = await this.jwt.verifyAsync<DownloadClaims>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
        audience: 'nidhisetu-document',
      });
    } catch {
      throw new ForbiddenError('This download link has expired or is invalid');
    }
    const doc = await this.prisma.document.findUnique({ where: { id: claims.doc } });
    if (!doc) throw new NotFoundError('Document');
    const ciphertext = await this.storage.get(doc.storageKey);
    const body = open(
      { ciphertext, iv: doc.iv, authTag: doc.authTag },
      this.config.DOCUMENT_ENCRYPTION_KEY,
      doc.storageKey,
    );
    if (sha256Hex(body) !== doc.sha256)
      throw new Error(`Integrity check failed for document ${doc.id}`);
    await this.audit.record({
      actor: { id: claims.sub, role: claims.role as Actor['role'] },
      action: claims.inline ? 'document.previewed' : 'document.downloaded',
      entityType: 'Document',
      entityId: doc.id,
      data: { instrumentId: doc.instrumentId, sha256: doc.sha256 },
    });
    return { doc, body, inline: claims.inline };
  }

  /** Raw (decrypted) bytes for internal use, e.g. sending a scan to the OCR service. */
  async readPlain(doc: Document): Promise<Buffer> {
    const ciphertext = await this.storage.get(doc.storageKey);
    return open(
      { ciphertext, iv: doc.iv, authTag: doc.authTag },
      this.config.DOCUMENT_ENCRYPTION_KEY,
      doc.storageKey,
    );
  }
}
