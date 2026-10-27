import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../auth/decorators.js';
import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Retention (docs/DPDP.md): closed records older than RETENTION_YEARS_CLOSED_RECORDS are listed as
 * due for archival review. Nothing is deleted automatically — the audit chain and financial records
 * may be under other legal holds, so purging is a deliberate, recorded decision.
 */
@ApiTags('admin')
@Controller('admin/retention')
export class RetentionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @RequirePermission('audit:read')
  @Get()
  async due() {
    const years = this.config.RETENTION_YEARS_CLOSED_RECORDS;
    const cutoff = this.clock.now();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    const where = {
      status: { in: ['RELEASED' as const, 'RENEWED' as const, 'REJECTED' as const] },
      closedAt: { lt: cutoff },
    };
    const [count, sample] = await Promise.all([
      this.prisma.instrument.count({ where }),
      this.prisma.instrument.findMany({
        where,
        select: { id: true, refNo: true, status: true, closedAt: true },
        orderBy: { closedAt: 'asc' },
        take: 50,
      }),
    ]);
    return {
      retentionYears: years,
      cutoff: cutoff.toISOString().slice(0, 10),
      dueForReview: count,
      items: sample.map((i) => ({ ...i, closedAt: i.closedAt?.toISOString() ?? null })),
    };
  }
}
