import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AuthenticatedOnly, CurrentUser, RequirePermission } from '../auth/decorators.js';
import { actorOf } from '../common/actor.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import type { Principal } from '../domain/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

const BankSchema = z.object({
  code: z.string().regex(/^[A-Z]{4}$/, 'IFSC bank prefix: 4 capital letters'),
  name: z.string().min(2).max(120),
  apiEnabled: z.boolean().default(false),
});
type BankInput = z.infer<typeof BankSchema>;

const RegionSchema = z.object({
  code: z.string().regex(/^[A-Z]{2,5}$/),
  name: z.string().min(2).max(120),
});
type RegionInput = z.infer<typeof RegionSchema>;

/** Master data: regions and the bank master (used by IFSC / unknown-bank discrepancy rules). */
@ApiTags('master')
@Controller('master')
export class MasterController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @AuthenticatedOnly()
  @Get('regions')
  regions() {
    return this.prisma.region.findMany({ orderBy: { name: 'asc' } });
  }

  @AuthenticatedOnly()
  @Get('banks')
  banks() {
    return this.prisma.bank.findMany({ orderBy: { name: 'asc' } });
  }

  @RequirePermission('master:manage')
  @Post('banks')
  @ApiZodBody(BankSchema)
  async createBank(@CurrentUser() me: Principal, @Body(new ZodPipe(BankSchema)) body: BankInput) {
    return this.prisma.$transaction(async (tx) => {
      const bank = await tx.bank.create({ data: body });
      await this.audit.record(
        {
          actor: actorOf(me),
          action: 'master.bank_created',
          entityType: 'Bank',
          entityId: bank.id,
          data: body,
        },
        tx,
      );
      return bank;
    });
  }

  @RequirePermission('master:manage')
  @Post('regions')
  @ApiZodBody(RegionSchema)
  async createRegion(
    @CurrentUser() me: Principal,
    @Body(new ZodPipe(RegionSchema)) body: RegionInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const region = await tx.region.create({ data: body });
      await this.audit.record(
        {
          actor: actorOf(me),
          action: 'master.region_created',
          entityType: 'Region',
          entityId: region.id,
          data: body,
        },
        tx,
      );
      return region;
    });
  }
}
