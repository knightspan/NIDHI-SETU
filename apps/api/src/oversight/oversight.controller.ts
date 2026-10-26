import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  InstitutionListQuerySchema,
  MetricBaselineSchema,
  REPORT_TYPES,
  ReportQuerySchema,
  SavedFilterSchema,
  type InstitutionListQuery,
  type MetricBaselineInput,
  type ReportQuery,
  type ReportType,
  type SavedFilterInput,
} from '@nidhisetu/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedOnly, CurrentUser, RequirePermission } from '../auth/decorators.js';
import { actorOf } from '../common/actor.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod.js';
import { NotFoundError } from '../domain/errors.js';
import type { Principal } from '../domain/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardService } from './dashboard.service.js';
import { InstitutionsService } from './institutions.service.js';
import { MetricsService } from './metrics.service.js';
import { ReportsService } from './reports.service.js';

const SearchQuery = z.object({ q: z.string().max(100).default('') });

@ApiTags('oversight')
@Controller()
export class OversightController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly institutions: InstitutionsService,
    private readonly metrics: MetricsService,
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermission('dashboard:read')
  @Get('dashboard')
  getDashboard(@CurrentUser() u: Principal) {
    return this.dashboard.build(u);
  }

  @RequirePermission('instrument:read', 'institution:read')
  @Get('search')
  @ApiZodQuery(SearchQuery)
  search(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(SearchQuery)) q: z.infer<typeof SearchQuery>,
  ) {
    return this.institutions.search(u, q.q);
  }

  @RequirePermission('institution:read')
  @Get('institutions')
  @ApiZodQuery(InstitutionListQuerySchema)
  listInstitutions(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(InstitutionListQuerySchema)) q: InstitutionListQuery,
  ) {
    return this.institutions.list(u, q);
  }

  @RequirePermission('institution:read')
  @Get('institutions/:id')
  institution(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.institutions.statement(u, id);
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

  @RequirePermission('report:read')
  @Get('reports/:type')
  @ApiZodQuery(ReportQuerySchema)
  async report(
    @CurrentUser() u: Principal,
    @Param('type') type: string,
    @Query(new ZodPipe(ReportQuerySchema)) q: ReportQuery,
    @Res() res: Response,
  ): Promise<void> {
    if (!(REPORT_TYPES as readonly string[]).includes(type)) throw new NotFoundError('Report');
    const out = await this.reports.export(u, type as ReportType, q);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(out.body);
  }

  /** The same report as JSON, for on-screen preview. */
  @RequirePermission('report:read')
  @Get('reports/:type/preview')
  @ApiZodQuery(ReportQuerySchema)
  preview(
    @CurrentUser() u: Principal,
    @Param('type') type: string,
    @Query(new ZodPipe(ReportQuerySchema)) q: ReportQuery,
  ) {
    if (!(REPORT_TYPES as readonly string[]).includes(type)) throw new NotFoundError('Report');
    return this.reports.build(u, type as ReportType, q);
  }

  // ─── Outcome metrics ──────────────────────────────────────────────────────

  @RequirePermission('metrics:read')
  @Get('metrics')
  getMetrics() {
    return this.metrics.all();
  }

  @RequirePermission('metrics:baseline')
  @Put('metrics/baselines/:key')
  @ApiZodBody(MetricBaselineSchema)
  setBaseline(
    @CurrentUser() u: Principal,
    @Param('key') key: string,
    @Body(new ZodPipe(MetricBaselineSchema)) body: MetricBaselineInput,
  ) {
    return this.metrics.setBaseline(key, body.value, body.note, actorOf(u));
  }

  // ─── Saved filters (per user) ─────────────────────────────────────────────

  @AuthenticatedOnly()
  @Get('saved-filters')
  savedFilters(@CurrentUser() u: Principal) {
    return this.prisma.savedFilter.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  @AuthenticatedOnly()
  @Post('saved-filters')
  @ApiZodBody(SavedFilterSchema)
  saveFilter(
    @CurrentUser() u: Principal,
    @Body(new ZodPipe(SavedFilterSchema)) body: SavedFilterInput,
  ) {
    return this.prisma.savedFilter.create({
      data: { userId: u.id, name: body.name, query: body.query },
    });
  }

  @AuthenticatedOnly()
  @Delete('saved-filters/:id')
  async deleteFilter(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.savedFilter.deleteMany({ where: { id, userId: u.id } });
    return { ok: true };
  }
}
