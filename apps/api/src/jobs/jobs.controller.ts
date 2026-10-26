import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { isoDate } from '@nidhisetu/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { actorOf } from '../common/actor.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod.js';
import { ClockService } from '../clock/clock.service.js';
import { addDays, istDateIso, toIso } from '../domain/dates.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DigestService } from './digest.service.js';
import { LifecycleService } from './lifecycle.service.js';

const ClockSchema = z
  .object({
    today: isoDate.optional(),
    advanceDays: z.number().int().min(-3650).max(3650).optional(),
    runLifecycle: z.boolean().default(true),
  })
  .refine((v) => v.today || v.advanceDays !== undefined, 'Give a date or a number of days');

const EscalationQuery = z.object({
  open: z.enum(['true', 'false']).default('true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

/** Demo clock (Section 3.6) and manual job triggers for the system administrator. */
@ApiTags('admin')
@Controller('admin')
export class JobsAdminController {
  constructor(
    private readonly clock: ClockService,
    private readonly lifecycle: LifecycleService,
    private readonly digest: DigestService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission('clock:manage')
  @Get('clock')
  async getClock() {
    await this.clock.sync(true);
    return {
      demoMode: this.clock.demoMode,
      today: this.clock.todayIso(),
      realToday: istDateIso(new Date()),
      offsetDays: this.clock.offset,
      lastLifecycleRun: await this.lifecycle.lastRun(),
    };
  }

  /** Moves "today" (by date or by N days) and, by default, runs the lifecycle job straight away. */
  @RequirePermission('clock:manage')
  @Post('clock')
  @HttpCode(200)
  @ApiZodBody(ClockSchema)
  async setClock(
    @CurrentUser() u: Principal,
    @Body(new ZodPipe(ClockSchema)) body: z.infer<typeof ClockSchema>,
  ) {
    await this.clock.sync(true);
    const target = body.today ?? toIso(addDays(this.clock.today(), body.advanceDays!));
    const before = this.clock.todayIso();
    const offset = await this.clock.setToday(target, u.id);
    await this.audit.record({
      actor: actorOf(u),
      action: 'clock.set',
      entityType: 'DemoClock',
      data: { from: before, to: target, offsetDays: offset },
    });
    const run = body.runLifecycle ? await this.lifecycle.run('clock', actorOf(u)) : null;
    return { today: this.clock.todayIso(), offsetDays: offset, lifecycle: run };
  }

  @RequirePermission('clock:manage')
  @Post('clock/reset')
  @HttpCode(200)
  async resetClock(@CurrentUser() u: Principal) {
    const target = istDateIso(new Date());
    const before = this.clock.todayIso();
    await this.clock.setToday(target, u.id);
    await this.audit.record({
      actor: actorOf(u),
      action: 'clock.reset',
      entityType: 'DemoClock',
      data: { from: before, to: target },
    });
    return {
      today: target,
      offsetDays: 0,
      lifecycle: await this.lifecycle.run('clock', actorOf(u)),
    };
  }

  @RequirePermission('clock:manage')
  @Post('jobs/lifecycle')
  @HttpCode(200)
  runLifecycle(@CurrentUser() u: Principal) {
    return this.lifecycle.run('manual', actorOf(u));
  }

  @RequirePermission('clock:manage')
  @Post('jobs/digest')
  @HttpCode(200)
  async runDigest() {
    const r = await this.digest.run(true);
    await this.notifications.flush();
    return r;
  }

  @RequirePermission('clock:manage')
  @Post('jobs/email-outbox')
  @HttpCode(200)
  flushEmail() {
    return this.notifications.flush();
  }
}

@ApiTags('escalations')
@Controller('escalations')
export class EscalationsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermission('escalation:read')
  @Get()
  @ApiZodQuery(EscalationQuery)
  async list(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(EscalationQuery)) q: z.infer<typeof EscalationQuery>,
  ) {
    const scope = instrumentScope(u) as Prisma.InstrumentWhereInput;
    const national = Object.keys(scope).length === 0;
    const scoped = national
      ? null
      : await this.prisma.instrument.findMany({ where: scope, select: { id: true } });
    const where: Prisma.EscalationWhereInput = {
      ...(scoped && { instrumentId: { in: scoped.map((s) => s.id) } }),
      ...(q.open === 'true' && { resolvedAt: null }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.escalation.count({ where }),
      this.prisma.escalation.findMany({
        where,
        orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const refs = await this.prisma.instrument.findMany({
      where: { id: { in: rows.map((r) => r.instrumentId).filter((x): x is string => !!x) } },
      select: { id: true, refNo: true, institution: { select: { name: true } } },
    });
    const byId = new Map(refs.map((r) => [r.id, r]));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        ...r,
        refNo: r.instrumentId ? (byId.get(r.instrumentId)?.refNo ?? null) : null,
        institutionName: r.instrumentId
          ? (byId.get(r.instrumentId)?.institution.name ?? null)
          : null,
      })),
    };
  }
}
