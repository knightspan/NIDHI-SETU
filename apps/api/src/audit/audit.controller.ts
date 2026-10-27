import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { actorOf } from '../common/actor.js';
import { ApiZodQuery, ZodPipe } from '../common/zod.js';
import type { Principal } from '../domain/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, type AuditVerifyResult } from './audit.service.js';

const AuditQuerySchema = z.object({
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
type AuditQuery = z.infer<typeof AuditQuerySchema>;

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermission('audit:read')
  @Get('events')
  @ApiZodQuery(AuditQuerySchema)
  async list(@Query(new ZodPipe(AuditQuerySchema)) q: AuditQuery) {
    const where: Prisma.AuditEventWhereInput = {
      ...(q.action && { action: { startsWith: q.action } }),
      ...(q.entityType && { entityType: q.entityType }),
      ...(q.entityId && { entityId: q.entityId }),
      ...(q.actorId && { actorId: q.actorId }),
      ...((q.from || q.to) && {
        occurredAt: {
          ...(q.from && { gte: new Date(`${q.from}T00:00:00+05:30`) }),
          ...(q.to && { lte: new Date(`${q.to}T23:59:59.999+05:30`) }),
        },
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { seq: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({ ...r, seq: r.seq.toString() })),
    };
  }

  /** Recomputes the full hash chain (Section 3.5). The check itself is audited. */
  @RequirePermission('audit:verify')
  @Post('verify')
  @HttpCode(200)
  async verify(@CurrentUser() user: Principal, @Body() _body: unknown): Promise<AuditVerifyResult> {
    const result = await this.audit.verify();
    await this.audit.record({
      actor: actorOf(user),
      action: 'audit.chain_verified',
      entityType: 'AuditChain',
      data: { ok: result.ok, checked: result.checked, breaks: result.breaks.length },
    });
    return result;
  }

  /** Signs the current head of the chain now (also done by the nightly job). */
  @RequirePermission('audit:verify')
  @Post('anchor')
  @HttpCode(200)
  async anchor(@CurrentUser() user: Principal, @Body() _body: unknown) {
    const a = await this.audit.anchor();
    if (a) {
      await this.audit.record({
        actor: actorOf(user),
        action: 'audit.anchored',
        entityType: 'AuditChain',
        data: { id: a.id, seq: a.seq.toString(), hash: a.hash },
      });
    }
    return a
      ? { id: a.id, seq: a.seq.toString(), hash: a.hash }
      : { id: null, note: 'Head already anchored' };
  }
}
