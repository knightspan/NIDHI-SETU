import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../common/actor.js';
import { RequestContext } from '../common/request-context.js';
import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG, auditAnchorKey, type AppConfig } from '../config/config.js';
import { checkAnchors, signAnchor } from '../domain/audit-anchor.js';
import {
  GENESIS_HASH,
  canonicalJson,
  computeAuditHash,
  verifyAuditChain,
  type ChainBreak,
  type StoredAuditEvent,
} from '../domain/audit-hash.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, beforeCommit, type Db } from '../prisma/prisma.service.js';

/** Advisory lock key that serialises appends to the hash chain. */
const AUDIT_LOCK_KEY = 726_265;
const VERIFY_PAGE = 5_000;

export interface AuditInput {
  actor: Actor | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: unknown;
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  /** Signed anchors checked against the chain (detects a fully recomputed chain). */
  anchorsChecked: number;
  breaks: ChainBreak[];
  verifiedAt: string;
  headHash: string;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Appends events to the chain. Pass the caller's transaction so the audit row commits atomically
   * with the change it describes; otherwise a new transaction is used.
   */
  /** Audit inputs waiting for their transaction's pre-commit hook. */
  private readonly pending = new WeakMap<object, AuditInput[]>();

  async record(input: AuditInput | AuditInput[], tx?: Prisma.TransactionClient): Promise<void> {
    const inputs = Array.isArray(input) ? input : [input];
    if (inputs.length === 0) return;
    if (tx) {
      // Appended just before the transaction commits (keeps the chain lock short); falls back to
      // appending now for transactions not opened through PrismaService.
      const pending = this.pending.get(tx);
      if (pending) {
        pending.push(...inputs);
        return;
      }
      const queued = [...inputs];
      if (
        beforeCommit(tx, () => {
          this.pending.delete(tx);
          return this.append(tx, queued);
        })
      ) {
        this.pending.set(tx, queued);
        return;
      }
      return this.append(tx, inputs);
    }
    await this.prisma.$transaction((t) => this.append(t, inputs), { timeout: 60_000 });
  }

  private async append(db: Prisma.TransactionClient, inputs: AuditInput[]): Promise<void> {
    await db.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY}::bigint)) AS l`;
    const last = await db.auditEvent.findFirst({
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true },
    });
    let prevHash = last?.hash ?? GENESIS_HASH;
    let seq = (last?.seq ?? 0n) + 1n;
    const ctx = RequestContext.get();
    const occurredAt = this.clock.now();
    const wallClock = this.clock.offset !== 0 ? new Date().toISOString() : undefined;

    const rows = inputs.map((i) => {
      const data = JSON.parse(
        canonicalJson({ ...(i.data as Record<string, unknown> | undefined), wallClock }),
      ) as Prisma.InputJsonValue;
      const event = {
        seq,
        occurredAt,
        actorId: i.actor?.id ?? null,
        actorRole: i.actor?.role ?? null,
        action: i.action,
        entityType: i.entityType,
        entityId: i.entityId ?? null,
        ip: ctx?.ip ?? null,
        data,
      };
      const hash = computeAuditHash(prevHash, event);
      const row = { ...event, prevHash, hash };
      prevHash = hash;
      seq += 1n;
      return row;
    });
    await db.auditEvent.createMany({ data: rows });
  }

  /** Recomputes the whole chain page by page and reports any break (Section 3.5). */
  async verify(db: Db = this.prisma): Promise<AuditVerifyResult> {
    let prev = GENESIS_HASH;
    let nextSeq = 1n;
    let checked = 0;
    const breaks: ChainBreak[] = [];
    for (;;) {
      const page = await db.auditEvent.findMany({
        where: { seq: { gte: nextSeq } },
        orderBy: { seq: 'asc' },
        take: VERIFY_PAGE,
      });
      if (page.length === 0) break;
      const r = verifyAuditChain(page as StoredAuditEvent[], prev, nextSeq);
      breaks.push(...r.breaks);
      checked += r.checked;
      prev = r.lastHash;
      nextSeq = page[page.length - 1]!.seq + 1n;
      if (breaks.length > 100) break;
    }
    // Anchors: the chain must still contain every signed checkpoint.
    const anchors = await db.auditAnchor.findMany({ orderBy: { id: 'asc' } });
    const anchored = await db.auditEvent.findMany({
      where: { seq: { in: anchors.map((a) => a.seq) } },
      select: { seq: true, hash: true },
    });
    // Anchor breaks first: they matter most and must survive the cap below.
    breaks.unshift(
      ...checkAnchors(
        anchors,
        new Map(anchored.map((e) => [e.seq, e.hash])),
        auditAnchorKey(this.config),
      ),
    );
    return {
      ok: breaks.length === 0,
      checked,
      anchorsChecked: anchors.length,
      breaks: breaks.slice(0, 100),
      verifiedAt: new Date().toISOString(),
      headHash: prev,
    };
  }

  /**
   * Signs the current head of the chain (run daily by the lifecycle job, or on demand). Returns the
   * new anchor, or null when the head is already anchored or the chain is empty.
   */
  async anchor(): Promise<{ id: number; seq: bigint; hash: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY}::bigint)) AS l`;
      const head = await tx.auditEvent.findFirst({
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      });
      if (!head) return null;
      const last = await tx.auditAnchor.findFirst({ orderBy: { id: 'desc' } });
      if (last && last.seq === head.seq) return null;
      const id = (last?.id ?? 0) + 1;
      const created = await tx.auditAnchor.create({
        data: {
          id,
          seq: head.seq,
          hash: head.hash,
          signature: signAnchor(auditAnchorKey(this.config), id, head.seq, head.hash),
          createdAt: this.clock.now(),
        },
      });
      return { id: created.id, seq: created.seq, hash: created.hash };
    });
  }
}
