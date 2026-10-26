import { Injectable } from '@nestjs/common';
import {
  MANUAL_DISCREPANCY_CODE,
  type CloseDiscrepancyInput,
  type DiscrepancyListQuery,
  type DiscrepancyView,
  type Paged,
  type RaiseDiscrepancyData,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { actorOf } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { DAY_MS } from '../domain/dates.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../domain/errors.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { TransitionsService } from '../instruments/transitions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';
import { DISCREPANCY_INCLUDE, toDiscrepancyViews } from './discrepancy-views.js';

@Injectable()
export class DiscrepanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instruments: InstrumentsService,
    private readonly transitions: TransitionsService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly rules: RulesService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(p: Principal, q: DiscrepancyListQuery): Promise<Paged<DiscrepancyView>> {
    const where: Prisma.DiscrepancyWhereInput = {
      instrument: instrumentScope(p),
      ...(q.status && { status: q.status }),
      ...(q.open === 'true' && { status: { in: ['OPEN', 'RESPONDED'] } }),
      ...(q.severity && { severity: q.severity }),
      ...(q.ruleCode && { ruleCode: q.ruleCode }),
      ...(q.instrumentId && { instrumentId: q.instrumentId }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.discrepancy.count({ where }),
      this.prisma.discrepancy.findMany({
        where,
        include: DISCREPANCY_INCLUDE,
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: await toDiscrepancyViews(this.prisma, rows),
    };
  }

  async forInstrument(instrumentId: string): Promise<DiscrepancyView[]> {
    const rows = await this.prisma.discrepancy.findMany({
      where: { instrumentId },
      include: DISCREPANCY_INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
    });
    return toDiscrepancyViews(this.prisma, rows);
  }

  private async getScoped(p: Principal, id: string) {
    const d = await this.prisma.discrepancy.findFirst({
      where: { id, instrument: instrumentScope(p) },
      include: { instrument: true },
    });
    if (!d) throw new NotFoundError('Discrepancy');
    return d;
  }

  /** Officer raises a discrepancy by hand; optionally sends the instrument back to the institution. */
  async raise(p: Principal, instrumentId: string, input: RaiseDiscrepancyData) {
    const inst = await this.instruments.getScoped(p, instrumentId);
    await this.instruments.assertAction(p, inst, 'raise_discrepancy');
    const actor = actorOf(p);
    const now = this.clock.now();
    const sla = await this.rules.get('escalation.sla');
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.discrepancy.create({
        data: {
          instrumentId,
          ruleCode: MANUAL_DISCREPANCY_CODE,
          field: input.field ?? null,
          severity: input.severity,
          description: input.description,
          raisedById: p.id,
          dueAt: new Date(now.getTime() + sla.discrepancyResponseDays * DAY_MS),
          createdAt: now,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'discrepancy.raised',
          entityType: 'Discrepancy',
          entityId: d.id,
          data: { instrumentId, field: input.field, severity: input.severity },
        },
        tx,
      );
      if (input.returnToInstitution && inst.status === 'UNDER_SCRUTINY') {
        await this.transitions.transition(tx, inst, 'DISCREPANCY_RAISED', actor, input.description);
      }
      await this.notifications.notifyInstrument(tx, instrumentId, ['INSTITUTION_USER'], {
        kind: 'DISCREPANCY',
        title: `AICTE raised a discrepancy on ${inst.refNo}`,
        body: `[${input.severity}] ${input.description}\nPlease respond in NidhiSetu.`,
      });
      return { id: d.id };
    });
  }

  /** Officer sends the instrument back with the discrepancies already open on it. */
  async returnToInstitution(p: Principal, instrumentId: string, note?: string) {
    const inst = await this.instruments.getScoped(p, instrumentId);
    await this.instruments.assertAction(p, inst, 'raise_discrepancy');
    if (inst.status !== 'UNDER_SCRUTINY')
      throw new ConflictError('Only an instrument under scrutiny can be returned');
    const open = await this.prisma.discrepancy.count({ where: { instrumentId, status: 'OPEN' } });
    if (open === 0)
      throw new ConflictError('There are no open discrepancies to send to the institution');
    await this.prisma.$transaction(async (tx) => {
      await this.transitions.transition(tx, inst, 'DISCREPANCY_RAISED', actorOf(p), note);
      await this.notifications.notifyInstrument(tx, instrumentId, ['INSTITUTION_USER'], {
        kind: 'DISCREPANCY',
        title: `${inst.refNo} returned to you with ${open} discrepanc${open === 1 ? 'y' : 'ies'}`,
        body: `Please answer each open discrepancy in NidhiSetu and send the instrument back for scrutiny.${note ? `\nOfficer's note: ${note}` : ''}`,
      });
    });
  }

  /** Thread message. An institution reply marks an OPEN discrepancy as RESPONDED. */
  async comment(p: Principal, id: string, body: string) {
    const d = await this.getScoped(p, id);
    if (p.role !== 'INSTITUTION_USER' && p.role !== 'RO_OFFICER')
      throw new ForbiddenError('Read-only role');
    if (d.status === 'RESOLVED' || d.status === 'WAIVED')
      throw new ConflictError('This discrepancy is closed');
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.discrepancyComment.create({
        data: { discrepancyId: id, authorId: p.id, authorRole: p.role, body, createdAt: now },
      });
      if (p.role === 'INSTITUTION_USER' && d.status === 'OPEN') {
        await tx.discrepancy.update({
          where: { id },
          data: { status: 'RESPONDED', respondedAt: now },
        });
      }
      await this.audit.record(
        {
          actor: actorOf(p),
          action: p.role === 'INSTITUTION_USER' ? 'discrepancy.responded' : 'discrepancy.commented',
          entityType: 'Discrepancy',
          entityId: id,
          data: { instrumentId: d.instrumentId },
        },
        tx,
      );
    });
  }

  /** Officer closes a discrepancy as resolved or waived (a note is mandatory). */
  async close(p: Principal, id: string, input: CloseDiscrepancyInput) {
    const d = await this.getScoped(p, id);
    if (d.status === 'RESOLVED' || d.status === 'WAIVED') throw new ConflictError('Already closed');
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.discrepancy.update({
        where: { id },
        data: { status: input.resolution, resolvedAt: now, resolvedById: p.id },
      });
      await tx.discrepancyComment.create({
        data: {
          discrepancyId: id,
          authorId: p.id,
          authorRole: p.role,
          body: `${input.resolution}: ${input.note}`,
          createdAt: now,
        },
      });
      await this.audit.record(
        {
          actor: actorOf(p),
          action: input.resolution === 'RESOLVED' ? 'discrepancy.resolved' : 'discrepancy.waived',
          entityType: 'Discrepancy',
          entityId: id,
          data: { instrumentId: d.instrumentId, note: input.note },
        },
        tx,
      );
    });
  }

  /** Institution finishes answering: DISCREPANCY_RAISED → UNDER_SCRUTINY. */
  async submitResponse(p: Principal, instrumentId: string, note?: string) {
    const inst = await this.instruments.getScoped(p, instrumentId);
    await this.instruments.assertAction(p, inst, 'respond');
    const open = await this.prisma.discrepancy.count({ where: { instrumentId, status: 'OPEN' } });
    if (open > 0) {
      throw new ConflictError(
        `Reply to every open discrepancy first (${open} still open)`,
        'OpenDiscrepancies',
      );
    }
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      await this.transitions.transition(tx, inst, 'UNDER_SCRUTINY', actor, note);
      await this.instruments.afterChange(tx, instrumentId, actor);
      await this.notifications.notifyInstrument(tx, instrumentId, ['RO_OFFICER'], {
        kind: 'RESPONSE',
        title: `Institution responded on ${inst.refNo}`,
        body: `The institution answered the discrepancies and sent ${inst.refNo} back for scrutiny.${note ? `\nNote: ${note}` : ''}`,
      });
    });
  }
}
