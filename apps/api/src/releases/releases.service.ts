import { Injectable } from '@nestjs/common';
import type {
  ExecuteReleaseInput,
  Paged,
  ReleaseChecklistItem,
  ReleaseListQuery,
  ReleaseView,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { SYSTEM_ACTOR, actorOf } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { dateOnly } from '../domain/dates.js';
import { requiredAmount } from '../domain/discrepancy-rules.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import {
  assertMakerChecker,
  checklistPassed,
  evaluateReleaseChecklist,
} from '../domain/release.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import { computeFieldStates, isFullyBankConfirmed } from '../domain/trust.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { TransitionsService } from '../instruments/transitions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService, type Db } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';
import { RELEASE_INCLUDE, toReleaseViews } from './release-views.js';

/**
 * Release / refund workflow (Section 7 · cap 6): request → automatic checklist → recommendation
 * (maker) → competent-authority decision (checker) → finance records execution.
 */
@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instruments: InstrumentsService,
    private readonly transitions: TransitionsService,
    private readonly rules: RulesService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Evaluates the configured preconditions for releasing an instrument right now. */
  async checklist(instrumentId: string, db: Db = this.prisma): Promise<ReleaseChecklistItem[]> {
    const inst = await db.instrument.findUniqueOrThrow({
      where: { id: instrumentId },
      include: { institution: true, assertions: true, documents: { select: { type: true } } },
    });
    const rules = await this.rules.current(this.clock.now(), db);
    const today = this.clock.today();
    const [unresolved, replacement, others] = await Promise.all([
      db.discrepancy.count({ where: { instrumentId, status: { in: ['OPEN', 'RESPONDED'] } } }),
      db.instrument.findFirst({
        where: {
          replacesInstrumentId: instrumentId,
          status: { notIn: ['REJECTED', 'ACTIVE', 'RENEWED', 'RELEASED'] },
        },
      }),
      db.instrument.aggregate({
        where: {
          institutionId: inst.institutionId,
          id: { not: instrumentId },
          status: { in: ['ACTIVE', 'RENEWAL_PENDING'] },
        },
        _sum: { amount: true },
      }),
    ]);
    const req = requiredAmount(
      inst.institution,
      rules['eligibility.exemption'],
      rules['amount.required'],
      today,
    );
    return evaluateReleaseChecklist(
      {
        unresolvedDiscrepancies: unresolved,
        fullyBankConfirmed: isFullyBankConfirmed(computeFieldStates(inst.assertions)),
        hasNoc: inst.documents.some((d) => d.type === 'NOC'),
        replacementInFlight: !!replacement,
        activatedAt: inst.activatedAt,
        today,
        requirement: {
          exempt: req.exempt,
          required: req.required,
          otherHeld: Number(others._sum.amount ?? 0),
        },
      },
      rules['release.preconditions'],
    );
  }

  async preview(p: Principal, instrumentId: string) {
    await this.instruments.getScoped(p, instrumentId);
    const items = await this.checklist(instrumentId);
    return { items, passed: checklistPassed(items) };
  }

  async list(p: Principal, q: ReleaseListQuery): Promise<Paged<ReleaseView>> {
    const where: Prisma.ReleaseRequestWhereInput = {
      instrument: instrumentScope(p),
      ...(q.status && { status: q.status }),
      ...(q.open === 'true' && { status: { in: ['REQUESTED', 'RECOMMENDED', 'APPROVED'] } }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.releaseRequest.count({ where }),
      this.prisma.releaseRequest.findMany({
        where,
        include: RELEASE_INCLUDE,
        orderBy: { requestedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: await toReleaseViews(this.prisma, rows),
    };
  }

  private async getScoped(p: Principal, id: string) {
    const r = await this.prisma.releaseRequest.findFirst({
      where: { id, instrument: instrumentScope(p) },
      include: { instrument: true },
    });
    if (!r) throw new NotFoundError('Release request');
    return r;
  }

  private async view(id: string): Promise<ReleaseView> {
    const row = await this.prisma.releaseRequest.findUniqueOrThrow({
      where: { id },
      include: RELEASE_INCLUDE,
    });
    return (await toReleaseViews(this.prisma, [row]))[0]!;
  }

  /** Institution asks for its deposit back (ACTIVE → RELEASE_REQUESTED). */
  async request(p: Principal, instrumentId: string, reason: string): Promise<ReleaseView> {
    const inst = await this.instruments.getScoped(p, instrumentId);
    await this.instruments.assertAction(p, inst, 'request_release');
    const actor = actorOf(p);
    const id = await this.prisma.$transaction(async (tx) => {
      const items = await this.checklist(instrumentId, tx);
      const r = await tx.releaseRequest.create({
        data: {
          instrumentId,
          reason,
          checklist: items.map((i) => ({ ...i })),
          checklistPassed: checklistPassed(items),
          requestedById: p.id,
          requestedAt: this.clock.now(),
        },
      });
      await this.transitions.transition(tx, inst, 'RELEASE_REQUESTED', actor, reason);
      await this.audit.record(
        {
          actor,
          action: 'release.requested',
          entityType: 'ReleaseRequest',
          entityId: r.id,
          data: { instrumentId, checklistPassed: r.checklistPassed },
        },
        tx,
      );
      await this.notifications.notifyInstrument(
        tx,
        instrumentId,
        ['RO_OFFICER', 'BUREAU_OFFICER'],
        {
          kind: 'RELEASE',
          title: `Release requested for ${inst.refNo}`,
          body: `${reason}\nChecklist: ${items.filter((i) => i.passed).length}/${items.length} preconditions met.`,
        },
      );
      return r.id;
    });
    return this.view(id);
  }

  /** Regional / bureau officer recommends (the "maker"). Every enabled precondition must pass now. */
  async recommend(p: Principal, id: string, note: string): Promise<ReleaseView> {
    const r = await this.getScoped(p, id);
    await this.instruments.assertAction(p, r.instrument, 'recommend_release');
    if (r.status !== 'REQUESTED')
      throw new ConflictError('This release is not awaiting a recommendation');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      const items = await this.checklist(r.instrumentId, tx);
      if (!checklistPassed(items)) {
        await tx.releaseRequest.update({
          where: { id },
          data: { checklist: items.map((i) => ({ ...i })), checklistPassed: false },
        });
        throw new ConflictError(
          `Preconditions not met: ${items
            .filter((i) => !i.passed)
            .map((i) => i.detail)
            .join('; ')}`,
          'ChecklistFailed',
        );
      }
      await tx.releaseRequest.update({
        where: { id },
        data: {
          status: 'RECOMMENDED',
          checklist: items.map((i) => ({ ...i })),
          checklistPassed: true,
          recommendedById: p.id,
          recommendedAt: this.clock.now(),
          recommendationNote: note,
        },
      });
      await this.transitions.transition(tx, r.instrument, 'RELEASE_RECOMMENDED', actor, note);
      await this.audit.record(
        {
          actor,
          action: 'release.recommended',
          entityType: 'ReleaseRequest',
          entityId: id,
          data: { note },
        },
        tx,
      );
      await this.notifications.notifyInstrument(tx, r.instrumentId, ['COMPETENT_AUTHORITY'], {
        kind: 'RELEASE',
        title: `Release of ${r.instrument.refNo} awaits your decision`,
        body: `Recommended: ${note}`,
      });
    });
    return this.view(id);
  }

  /** Officer declines to recommend: RELEASE_REQUESTED → RELEASE_REJECTED → ACTIVE. */
  async decline(p: Principal, id: string, note: string): Promise<ReleaseView> {
    const r = await this.getScoped(p, id);
    await this.instruments.assertAction(p, r.instrument, 'decline_release');
    if (r.status !== 'REQUESTED')
      throw new ConflictError('This release is not awaiting a recommendation');
    await this.reject(r, p, note, 'release.declined');
    return this.view(id);
  }

  /** Competent authority approves (the "checker"); maker-checker enforced. */
  async approve(p: Principal, id: string, note: string): Promise<ReleaseView> {
    const r = await this.getScoped(p, id);
    if (r.status !== 'RECOMMENDED')
      throw new ConflictError('This release is not awaiting a decision');
    assertMakerChecker(r, p.id);
    await this.instruments.assertAction(p, r.instrument, 'approve_release');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      await tx.releaseRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedById: p.id,
          decidedAt: this.clock.now(),
          decisionNote: note,
        },
      });
      await this.transitions.transition(tx, r.instrument, 'RELEASE_APPROVED', actor, note);
      await this.audit.record(
        {
          actor,
          action: 'release.approved',
          entityType: 'ReleaseRequest',
          entityId: id,
          data: { note, recommendedBy: r.recommendedById },
        },
        tx,
      );
      await this.notifications.notifyInstrument(
        tx,
        r.instrumentId,
        ['FINANCE_OFFICER', 'INSTITUTION_USER'],
        {
          kind: 'RELEASE',
          title: `Release of ${r.instrument.refNo} approved`,
          body: `The competent authority approved the release. Finance will record the discharge.${note ? `\nNote: ${note}` : ''}`,
        },
      );
    });
    return this.view(id);
  }

  /** Competent authority rejects: RELEASE_RECOMMENDED → RELEASE_REJECTED → ACTIVE. */
  async rejectByAuthority(p: Principal, id: string, note: string): Promise<ReleaseView> {
    const r = await this.getScoped(p, id);
    if (r.status !== 'RECOMMENDED')
      throw new ConflictError('This release is not awaiting a decision');
    assertMakerChecker(r, p.id);
    await this.instruments.assertAction(p, r.instrument, 'reject_release');
    await this.reject(r, p, note, 'release.rejected');
    return this.view(id);
  }

  private async reject(
    r: { id: string; instrumentId: string; instrument: { refNo: string } },
    p: Principal,
    note: string,
    action: string,
  ): Promise<void> {
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      const inst = await tx.instrument.findUniqueOrThrow({ where: { id: r.instrumentId } });
      await tx.releaseRequest.update({
        where: { id: r.id },
        data: {
          status: 'REJECTED',
          decidedById: p.id,
          decidedAt: this.clock.now(),
          decisionNote: note,
        },
      });
      const rejected = await this.transitions.transition(tx, inst, 'RELEASE_REJECTED', actor, note);
      // The instrument never rests in RELEASE_REJECTED (docs/DECISIONS.md D-012).
      await this.transitions.transition(
        tx,
        rejected,
        'ACTIVE',
        SYSTEM_ACTOR,
        'Reinstated after release rejection',
      );
      await this.audit.record(
        { actor, action, entityType: 'ReleaseRequest', entityId: r.id, data: { note } },
        tx,
      );
      await this.notifications.notifyInstrument(tx, r.instrumentId, ['INSTITUTION_USER'], {
        kind: 'RELEASE',
        title: `Release of ${r.instrument.refNo} not approved`,
        body: `Reason: ${note}\nThe deposit remains held by AICTE.`,
      });
    });
  }

  /** Finance records the discharge done outside the portal: RELEASE_APPROVED → RELEASED. */
  async execute(p: Principal, id: string, input: ExecuteReleaseInput): Promise<ReleaseView> {
    const r = await this.getScoped(p, id);
    await this.instruments.assertAction(p, r.instrument, 'execute_release');
    if (r.status !== 'APPROVED') throw new ConflictError('Only approved releases can be executed');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      await tx.releaseRequest.update({
        where: { id },
        data: {
          status: 'EXECUTED',
          executionRef: input.executionRef,
          executionDate: dateOnly(input.executionDate),
          executedById: p.id,
          executedAt: this.clock.now(),
        },
      });
      await this.transitions.transition(
        tx,
        r.instrument,
        'RELEASED',
        actor,
        `Executed: ${input.executionRef}${input.note ? ` — ${input.note}` : ''}`,
      );
      await tx.instrument.update({ where: { id: r.instrumentId }, data: { validityStatus: null } });
      await this.audit.record(
        {
          actor,
          action: 'release.executed',
          entityType: 'ReleaseRequest',
          entityId: id,
          data: { ...input },
        },
        tx,
      );
      await this.notifications.notifyInstrument(
        tx,
        r.instrumentId,
        ['INSTITUTION_USER', 'RO_OFFICER'],
        {
          kind: 'RELEASE',
          title: `${r.instrument.refNo} released`,
          body: `Finance recorded the discharge (ref. ${input.executionRef}, ${input.executionDate}). The lien can now be lifted by the bank.`,
        },
      );
    });
    return this.view(id);
  }
}
