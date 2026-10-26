import { Injectable } from '@nestjs/common';
import {
  FIELD_KEYS,
  type FieldKey,
  type InstrumentDeclaration,
  type InstrumentDetail,
  type InstrumentListQuery,
  type InstrumentSummary,
  type LifecycleStatus,
  type Paged,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { actorOf, type Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { allowedActions, type InstrumentAction } from '../domain/actions.js';
import { toIso } from '../domain/dates.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../domain/errors.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import { computeFieldStates } from '../domain/trust.js';
import type { Instrument, Prisma } from '../generated/prisma/client.js';
import { PrismaService, type Db } from '../prisma/prisma.service.js';
import { AssertionsService, type AssertionInput } from './assertions.service.js';
import { SUMMARY_INCLUDE, UNRESOLVED_DISCREPANCY, toSummary } from './instrument-views.js';
import { TransitionsService } from './transitions.service.js';

const QUEUES: Record<NonNullable<InstrumentListQuery['queue']>, Prisma.InstrumentWhereInput> = {
  scrutiny: {
    status: { in: ['SUBMITTED', 'UNDER_SCRUTINY', 'DISCREPANCY_RAISED', 'OFFICER_VERIFIED'] },
  },
  bank: { status: 'BANK_CONFIRMATION_PENDING' },
  renewal: {
    OR: [
      { status: 'RENEWAL_PENDING' },
      { status: 'ACTIVE', validityStatus: { in: ['EXPIRING_SOON', 'MATURED', 'OVERDUE_RENEWAL'] } },
    ],
  },
  release: { status: { in: ['RELEASE_REQUESTED', 'RELEASE_RECOMMENDED', 'RELEASE_APPROVED'] } },
};

export function declarationToAssertions(
  d: InstrumentDeclaration,
  source = 'institution',
): AssertionInput[] {
  const values: Record<FieldKey, unknown> = {
    fdrNumber: d.fdrNumber,
    bankCode: d.bankCode,
    ifsc: d.ifsc,
    amount: d.amount,
    issueDate: d.issueDate,
    maturityDate: d.maturityDate,
    depositorNames: d.depositorNames,
    lienMarked: d.lienMarked,
    autoRenewal: d.autoRenewal,
  };
  return FIELD_KEYS.map((field) => ({
    field,
    value: values[field],
    trust: 'DECLARED' as const,
    source,
  }));
}

@Injectable()
export class InstrumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assertions: AssertionsService,
    private readonly transitions: TransitionsService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  /** Loads an instrument the principal is allowed to see, or 404 (never 403, to avoid leaking existence). */
  async getScoped(p: Principal, id: string, db: Db = this.prisma): Promise<Instrument> {
    const inst = await db.instrument.findFirst({ where: { AND: [instrumentScope(p), { id }] } });
    if (!inst) throw new NotFoundError('Instrument');
    return inst;
  }

  /** Throws unless `action` is currently allowed for this user on this instrument. */
  async assertAction(
    p: Principal,
    inst: Instrument,
    action: InstrumentAction,
    db: Db = this.prisma,
  ): Promise<void> {
    const actions = await this.actionsFor(p, inst, db);
    if (!actions.includes(action)) {
      throw new ConflictError(
        `"${action}" is not possible while the instrument is ${inst.status}`,
        'ActionNotAllowed',
      );
    }
  }

  async actionsFor(
    p: Principal,
    inst: Instrument,
    db: Db = this.prisma,
  ): Promise<InstrumentAction[]> {
    const [unresolved, replacement, release] = await Promise.all([
      db.discrepancy.count({ where: { instrumentId: inst.id, ...UNRESOLVED_DISCREPANCY } }),
      db.instrument.count({
        where: { replacesInstrumentId: inst.id, status: { not: 'REJECTED' } },
      }),
      db.releaseRequest.findFirst({
        where: { instrumentId: inst.id, status: { in: ['REQUESTED', 'RECOMMENDED', 'APPROVED'] } },
        orderBy: { requestedAt: 'desc' },
      }),
    ]);
    return allowedActions(p, {
      status: inst.status,
      unresolvedDiscrepancies: unresolved,
      hasReplacement: replacement > 0,
      release: release
        ? { requestedById: release.requestedById, recommendedById: release.recommendedById }
        : null,
    });
  }

  async list(p: Principal, q: InstrumentListQuery): Promise<Paged<InstrumentSummary>> {
    const filters: Prisma.InstrumentWhereInput[] = [instrumentScope(p)];
    if (q.q) {
      const term = q.q;
      filters.push({
        OR: [
          { refNo: { contains: term, mode: 'insensitive' } },
          { fdrNumber: { contains: term, mode: 'insensitive' } },
          { bankCode: { equals: term.toUpperCase() } },
          { bank: { name: { contains: term, mode: 'insensitive' } } },
          { institution: { name: { contains: term, mode: 'insensitive' } } },
          { institution: { aicteId: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }
    if (q.status) filters.push({ status: { in: q.status } });
    if (q.validity) filters.push({ validityStatus: q.validity });
    if (q.regionId) filters.push({ institution: { regionId: q.regionId } });
    if (q.bankCode) filters.push({ bankCode: q.bankCode });
    if (q.institutionId) filters.push({ institutionId: q.institutionId });
    if (q.maturityFrom || q.maturityTo) {
      filters.push({
        maturityDate: {
          ...(q.maturityFrom && { gte: new Date(`${q.maturityFrom}T00:00:00Z`) }),
          ...(q.maturityTo && { lte: new Date(`${q.maturityTo}T00:00:00Z`) }),
        },
      });
    }
    if (q.mismatch)
      filters.push(q.mismatch === 'true' ? { mismatchCount: { gt: 0 } } : { mismatchCount: 0 });
    if (q.legacy) filters.push({ legacy: q.legacy === 'true' });
    if (q.queue) filters.push(QUEUES[q.queue]);

    const where: Prisma.InstrumentWhereInput = { AND: filters };
    const [total, rows] = await Promise.all([
      this.prisma.instrument.count({ where }),
      this.prisma.instrument.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: [
          // `nulls` is only valid on nullable columns.
          q.sort === 'maturityDate' || q.sort === 'amount'
            ? { [q.sort]: { sort: q.dir, nulls: 'last' } }
            : { [q.sort]: q.dir },
          { id: 'asc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map(toSummary) };
  }

  async detail(p: Principal, id: string): Promise<InstrumentDetail> {
    const base = await this.getScoped(p, id);
    const inst = await this.prisma.instrument.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        ...SUMMARY_INCLUDE,
        institution: {
          select: {
            id: true,
            name: true,
            aicteId: true,
            trustName: true,
            state: true,
            yearEstablished: true,
            programmes: true,
            regionId: true,
            region: { select: { name: true } },
          },
        },
        assertions: { orderBy: { createdAt: 'desc' } },
        documents: { orderBy: [{ type: 'asc' }, { version: 'desc' }] },
        transitions: { orderBy: { at: 'asc' } },
        replacedBy: { select: { id: true, refNo: true, status: true } },
      },
    });

    const userIds = new Set<string>();
    inst.assertions.forEach((a) => a.actorId && userIds.add(a.actorId));
    inst.transitions.forEach((t) => t.actorId && userIds.add(t.actorId));
    inst.documents.forEach((d) => userIds.add(d.uploadedById));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));

    const states = computeFieldStates(inst.assertions);
    const supersededBy = new Map<string, string>();
    inst.documents.forEach((d) => d.supersedesId && supersededBy.set(d.supersedesId, d.id));

    await this.audit.record({
      actor: actorOf(p),
      action: 'instrument.viewed',
      entityType: 'Instrument',
      entityId: inst.id,
      data: { refNo: inst.refNo },
    });

    return {
      ...toSummary(inst),
      branch: inst.branch,
      ifsc: inst.ifsc,
      depositorNames: inst.depositorNames,
      jointName: inst.jointName,
      lienMarked: inst.lienMarked,
      autoRenewal: inst.autoRenewal,
      submittedAt: inst.submittedAt?.toISOString() ?? null,
      activatedAt: inst.activatedAt?.toISOString() ?? null,
      closedAt: inst.closedAt?.toISOString() ?? null,
      createdAt: inst.createdAt.toISOString(),
      institutionDetail: {
        trustName: inst.institution.trustName,
        state: inst.institution.state,
        yearEstablished: inst.institution.yearEstablished,
        programmes: inst.institution.programmes,
        regionId: inst.institution.regionId,
      },
      fields: FIELD_KEYS.map((f) => ({
        field: f,
        effectiveValue: states[f].effectiveValue,
        effectiveTrust: states[f].effectiveTrust,
        mismatch: states[f].mismatch,
        history: inst.assertions
          .filter((a) => a.field === f)
          .map((a) => ({
            id: a.id,
            value: a.value,
            trust: a.trust,
            source: a.source,
            confidence: a.confidence,
            actorName: a.actorId ? (nameOf.get(a.actorId) ?? null) : null,
            createdAt: a.createdAt.toISOString(),
            evidenceDocumentId: a.evidenceDocumentId,
          })),
      })),
      documents: inst.documents.map((d) => ({
        id: d.id,
        type: d.type,
        originalName: d.originalName,
        mimeType: d.mimeType,
        size: d.size,
        sha256: d.sha256,
        version: d.version,
        supersededBy: supersededBy.get(d.id) ?? null,
        uploadedBy: nameOf.get(d.uploadedById) ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      transitions: inst.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        action: t.action,
        actorName: t.actorId ? (nameOf.get(t.actorId) ?? null) : null,
        actorRole: t.actorRole as InstrumentDetail['transitions'][number]['actorRole'],
        note: t.note,
        at: t.at.toISOString(),
      })),
      chain: await this.renewalChain(inst.id),
      replacedBy: inst.replacedBy,
      allowedActions: await this.actionsFor(p, inst),
    };
  }

  /** Full renewal chain, oldest first (Section 7 · cap 5). */
  async renewalChain(id: string, db: Db = this.prisma): Promise<InstrumentDetail['chain']> {
    const select = {
      id: true,
      refNo: true,
      status: true,
      maturityDate: true,
      amount: true,
      replacesInstrumentId: true,
    } as const;
    const start = await db.instrument.findUniqueOrThrow({ where: { id }, select });
    const back: (typeof start)[] = [];
    let cur = start;
    for (let guard = 0; cur.replacesInstrumentId && guard < 50; guard++) {
      const prev = await db.instrument.findUnique({
        where: { id: cur.replacesInstrumentId },
        select,
      });
      if (!prev) break;
      back.unshift(prev);
      cur = prev;
    }
    const forward: (typeof start)[] = [];
    cur = start;
    for (let guard = 0; guard < 50; guard++) {
      const next = await db.instrument.findFirst({
        where: { replacesInstrumentId: cur.id },
        select,
      });
      if (!next) break;
      forward.push(next);
      cur = next;
    }
    const all = [...back, start, ...forward];
    if (all.length === 1) return [];
    return all.map((i) => ({
      id: i.id,
      refNo: i.refNo,
      status: i.status,
      maturityDate: i.maturityDate ? toIso(i.maturityDate) : null,
      amount: i.amount?.toFixed(2) ?? null,
    }));
  }

  async nextRefNo(tx: Prisma.TransactionClient): Promise<string> {
    const year = this.clock.now().getFullYear();
    const c = await tx.counter.upsert({
      where: { name: `instrument-${year}` },
      create: { name: `instrument-${year}`, value: 1 },
      update: { value: { increment: 1 } },
    });
    return `NS-${year}-${String(c.value).padStart(6, '0')}`;
  }

  /** Institution creates a DRAFT; every declared value becomes a DECLARED assertion. */
  async create(
    p: Principal,
    d: InstrumentDeclaration,
    opts: { replacesInstrumentId?: string } = {},
  ): Promise<{ id: string; refNo: string }> {
    if (!p.institutionId)
      throw new ForbiddenError('Only institution users can declare instruments');
    const actor = actorOf(p);
    return this.prisma.$transaction(async (tx) => {
      const refNo = await this.nextRefNo(tx);
      const inst = await tx.instrument.create({
        data: {
          refNo,
          type: d.type,
          institutionId: p.institutionId!,
          branch: d.branch,
          status: 'DRAFT',
          createdById: p.id,
          replacesInstrumentId: opts.replacesInstrumentId ?? null,
          createdAt: this.clock.now(),
          statusChangedAt: this.clock.now(),
        },
      });
      await tx.statusTransition.create({
        data: {
          instrumentId: inst.id,
          from: null,
          to: 'DRAFT',
          action: 'create',
          actorId: p.id,
          actorRole: p.role,
          at: this.clock.now(),
        },
      });
      await this.assertions.apply(tx, inst.id, declarationToAssertions(d), actor);
      await this.audit.record(
        {
          actor,
          action: 'instrument.created',
          entityType: 'Instrument',
          entityId: inst.id,
          data: { refNo, replaces: opts.replacesInstrumentId },
        },
        tx,
      );
      return { id: inst.id, refNo };
    });
  }

  /** Institution edits its declaration (DRAFT, or while answering a discrepancy). */
  async updateDeclared(p: Principal, id: string, d: InstrumentDeclaration): Promise<void> {
    const inst = await this.getScoped(p, id);
    await this.assertAction(p, inst, 'edit');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      await tx.instrument.update({ where: { id }, data: { branch: d.branch, type: d.type } });
      const { added } = await this.assertions.apply(tx, id, declarationToAssertions(d), actor);
      await this.audit.record(
        {
          actor,
          action: 'instrument.declaration_updated',
          entityType: 'Instrument',
          entityId: id,
          data: { changedFields: added },
        },
        tx,
      );
      await this.afterChange(tx, id, actor);
    });
  }

  async submit(p: Principal, id: string): Promise<void> {
    const inst = await this.getScoped(p, id);
    await this.assertAction(p, inst, 'submit');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      await this.transitions.transition(tx, inst, 'SUBMITTED', actor);
      await this.afterChange(tx, id, actor);
      if (inst.replacesInstrumentId)
        await this.onReplacementSubmitted(tx, inst.replacesInstrumentId, actor);
    });
  }

  async deleteDraft(p: Principal, id: string): Promise<void> {
    const inst = await this.getScoped(p, id);
    await this.assertAction(p, inst, 'delete');
    await this.prisma.$transaction(async (tx) => {
      await tx.document.updateMany({ where: { instrumentId: id }, data: { instrumentId: null } });
      await tx.instrument.delete({ where: { id } });
      await this.audit.record(
        {
          actor: actorOf(p),
          action: 'instrument.draft_deleted',
          entityType: 'Instrument',
          entityId: id,
          data: { refNo: inst.refNo },
        },
        tx,
      );
    });
  }

  /**
   * Hook run after anything that can change an instrument's evidence. Later phases plug in
   * discrepancy evaluation here.
   */
  async afterChange(_tx: Prisma.TransactionClient, _id: string, _actor: Actor): Promise<void> {
    // Extended in Phase 3 (discrepancy rules).
  }

  /** Renewal: the old instrument waits for its replacement (Phase 6). */
  async onReplacementSubmitted(
    _tx: Prisma.TransactionClient,
    _oldId: string,
    _actor: Actor,
  ): Promise<void> {
    // Extended in Phase 6.
  }

  isStatus(inst: Instrument, ...s: LifecycleStatus[]): boolean {
    return s.includes(inst.status);
  }
}
