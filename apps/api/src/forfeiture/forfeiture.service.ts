import { Injectable } from '@nestjs/common';
import type {
  ForfeitureExecuteInput,
  ForfeitureProposeInput,
  ForfeitureView,
  Paged,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { actorOf } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { dateOnly } from '../domain/dates.js';
import { ConflictError, NotFoundError, SegregationOfDutiesError } from '../domain/errors.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { TransitionsService } from '../instruments/transitions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FORFEITURE_INCLUDE, toForfeitureViews } from './forfeiture-views.js';

/**
 * Forfeiture (invocation) of a security deposit: ACTIVE → FORFEITURE_PROPOSED → FORFEITURE_APPROVED
 * → FORFEITED. An officer proposes with a reason and the order it relies on (maker); the competent
 * authority decides (checker, never the proposer) and only after a fresh bank re-verification (the
 * same gate as release, enforced in the state machine); finance records the invocation.
 * NidhiSetu records the decision; it never moves money.
 */
@Injectable()
export class ForfeitureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instruments: InstrumentsService,
    private readonly transitions: TransitionsService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
  ) {}

  private async getScoped(p: Principal, id: string) {
    const r = await this.prisma.forfeitureRequest.findFirst({
      where: { id, instrument: instrumentScope(p) },
      include: { instrument: true },
    });
    if (!r) throw new NotFoundError('Forfeiture');
    return r;
  }

  private async view(id: string): Promise<ForfeitureView> {
    const row = await this.prisma.forfeitureRequest.findUniqueOrThrow({
      where: { id },
      include: FORFEITURE_INCLUDE,
    });
    return (await toForfeitureViews(this.prisma, [row]))[0]!;
  }

  async list(p: Principal, open: boolean): Promise<Paged<ForfeitureView>> {
    const rows = await this.prisma.forfeitureRequest.findMany({
      where: {
        instrument: instrumentScope(p),
        ...(open ? { status: { in: ['PROPOSED', 'APPROVED'] } } : {}),
      },
      include: FORFEITURE_INCLUDE,
      orderBy: { proposedAt: 'desc' },
      take: 200,
    });
    return {
      items: await toForfeitureViews(this.prisma, rows),
      total: rows.length,
      page: 1,
      pageSize: 200,
    };
  }

  /** Maker: ACTIVE → FORFEITURE_PROPOSED. Reason and order reference are mandatory. */
  async propose(
    p: Principal,
    instrumentId: string,
    input: ForfeitureProposeInput,
  ): Promise<ForfeitureView> {
    const inst = await this.instruments.getScoped(p, instrumentId);
    await this.instruments.assertAction(p, inst, 'propose_forfeiture');
    const actor = actorOf(p);
    const id = await this.prisma.$transaction(async (tx) => {
      const f = await tx.forfeitureRequest.create({
        data: {
          instrumentId,
          reason: input.reason,
          orderReference: input.orderReference,
          proposedById: p.id,
          proposedAt: this.clock.now(),
        },
      });
      await this.transitions.transition(
        tx,
        inst,
        'FORFEITURE_PROPOSED',
        actor,
        `${input.orderReference}: ${input.reason}`,
      );
      await this.audit.record(
        {
          actor,
          action: 'forfeiture.proposed',
          entityType: 'ForfeitureRequest',
          entityId: f.id,
          data: { instrumentId, ...input },
        },
        tx,
      );
      await this.notifications.notifyInstrument(
        tx,
        instrumentId,
        ['COMPETENT_AUTHORITY', 'INSTITUTION_USER'],
        {
          kind: 'RELEASE',
          title: `Forfeiture proposed for ${inst.refNo}`,
          body: `Order ${input.orderReference}. Reason: ${input.reason}`,
          sms: true,
        },
      );
      return f.id;
    });
    return this.view(id);
  }

  /** Checker: FORFEITURE_PROPOSED → FORFEITURE_APPROVED, behind the re-verification gate. */
  async approve(p: Principal, id: string, note: string): Promise<ForfeitureView> {
    const f = await this.getScoped(p, id);
    if (f.status !== 'PROPOSED')
      throw new ConflictError('This forfeiture is not awaiting a decision');
    if (f.proposedById === p.id)
      throw new SegregationOfDutiesError(
        'Maker-checker: the officer who proposed a forfeiture cannot approve it',
      );
    await this.instruments.assertAction(p, f.instrument, 'approve_forfeiture');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      // The state machine's REVERIFICATION gate runs inside this transition.
      await this.transitions.transition(tx, f.instrument, 'FORFEITURE_APPROVED', actor, note);
      await tx.forfeitureRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedById: p.id,
          decidedAt: this.clock.now(),
          decisionNote: note,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'forfeiture.approved',
          entityType: 'ForfeitureRequest',
          entityId: id,
          data: { note, proposedBy: f.proposedById },
        },
        tx,
      );
      await this.notifications.notifyInstrument(
        tx,
        f.instrumentId,
        ['FINANCE_OFFICER', 'INSTITUTION_USER', 'RO_OFFICER'],
        {
          kind: 'RELEASE',
          title: `Forfeiture of ${f.instrument.refNo} approved`,
          body: `Order ${f.orderReference}. Finance will record the invocation.`,
        },
      );
    });
    return this.view(id);
  }

  /** Checker declines: FORFEITURE_PROPOSED → ACTIVE. */
  async reject(p: Principal, id: string, note: string): Promise<ForfeitureView> {
    const f = await this.getScoped(p, id);
    if (f.status !== 'PROPOSED')
      throw new ConflictError('This forfeiture is not awaiting a decision');
    if (f.proposedById === p.id)
      throw new SegregationOfDutiesError(
        'Maker-checker: the officer who proposed a forfeiture cannot decide it',
      );
    await this.instruments.assertAction(p, f.instrument, 'reject_forfeiture');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      await this.transitions.transition(tx, f.instrument, 'ACTIVE', actor, note);
      await tx.forfeitureRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedById: p.id,
          decidedAt: this.clock.now(),
          decisionNote: note,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'forfeiture.rejected',
          entityType: 'ForfeitureRequest',
          entityId: id,
          data: { note },
        },
        tx,
      );
      await this.notifications.notifyInstrument(
        tx,
        f.instrumentId,
        ['RO_OFFICER', 'INSTITUTION_USER'],
        {
          kind: 'RELEASE',
          title: `Forfeiture of ${f.instrument.refNo} not approved`,
          body: `Reason: ${note}\nThe deposit remains held by AICTE.`,
        },
      );
    });
    return this.view(id);
  }

  /** Finance records the invocation done outside the portal: FORFEITURE_APPROVED → FORFEITED. */
  async execute(p: Principal, id: string, input: ForfeitureExecuteInput): Promise<ForfeitureView> {
    const f = await this.getScoped(p, id);
    if (f.status !== 'APPROVED')
      throw new ConflictError('Only approved forfeitures can be executed');
    await this.instruments.assertAction(p, f.instrument, 'execute_forfeiture');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      await tx.forfeitureRequest.update({
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
        f.instrument,
        'FORFEITED',
        actor,
        `Invoked: ${input.executionRef}${input.note ? ` — ${input.note}` : ''}`,
      );
      await tx.instrument.update({ where: { id: f.instrumentId }, data: { validityStatus: null } });
      await this.audit.record(
        {
          actor,
          action: 'forfeiture.executed',
          entityType: 'ForfeitureRequest',
          entityId: id,
          data: { ...input },
        },
        tx,
      );
      await this.notifications.notifyInstrument(
        tx,
        f.instrumentId,
        ['INSTITUTION_USER', 'RO_OFFICER'],
        {
          kind: 'RELEASE',
          title: `${f.instrument.refNo} forfeited`,
          body: `Finance recorded the invocation (ref. ${input.executionRef}, ${input.executionDate}) under order ${f.orderReference}.`,
        },
      );
    });
    return this.view(id);
  }
}
