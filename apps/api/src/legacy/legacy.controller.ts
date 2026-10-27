import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  LegacyConfirmSchema,
  NoteSchema,
  type LegacyConfirmData,
  type NoteInput,
} from '@nidhisetu/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { actorOf } from '../common/actor.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import type { UploadedFile as File } from '../documents/documents.service.js';
import type { Principal } from '../domain/scope.js';
import { toCsv } from '../oversight/reports.service.js';
import { LegacyService } from './legacy.service.js';

const BatchBody = z.object({ label: z.string().trim().min(1).max(120).default('Legacy batch') });
const ReconQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });

@ApiTags('legacy')
@Controller('legacy')
export class LegacyController {
  constructor(
    private readonly legacy: LegacyService,
    private readonly audit: AuditService,
  ) {}

  /** Bulk upload of physical-FDR scans: multiple PDFs / images, or ZIP archives of them. */
  @RequirePermission('legacy:upload')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('batches')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('files', 50, { limits: { fileSize: 100 * 1024 * 1024 } }))
  createBatch(
    @CurrentUser() u: Principal,
    @UploadedFiles() files: File[] | undefined,
    @Body(new ZodPipe(BatchBody)) body: z.infer<typeof BatchBody>,
  ) {
    return this.legacy.createBatch(u, body.label, files ?? []);
  }

  @RequirePermission('legacy:upload')
  @Get('batches')
  list(@CurrentUser() u: Principal) {
    return this.legacy.listBatches(u);
  }

  @RequirePermission('legacy:upload')
  @Get('batches/:id')
  batch(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.legacy.batch(u, id);
  }

  @RequirePermission('legacy:upload')
  @Post('items/:id/confirm')
  @HttpCode(200)
  @ApiZodBody(LegacyConfirmSchema)
  confirm(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(LegacyConfirmSchema)) body: LegacyConfirmData,
  ) {
    return this.legacy.confirm(u, id, body);
  }

  @RequirePermission('legacy:upload')
  @Post('items/:id/reject')
  @HttpCode(200)
  @ApiZodBody(NoteSchema)
  async reject(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(NoteSchema)) body: NoteInput,
  ) {
    await this.legacy.reject(u, id, body.note);
    return { ok: true };
  }

  @RequirePermission('legacy:upload')
  @Get('reconciliation')
  async reconciliation(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(ReconQuery)) q: z.infer<typeof ReconQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.legacy.reconciliation(u);
    if (q.format === 'json') return report;
    await this.audit.record({
      actor: actorOf(u),
      action: 'report.exported',
      entityType: 'Report',
      entityId: 'legacy-reconciliation',
      data: { rows: report.rows.length },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nidhisetu-reconciliation-${report.generatedFor}.csv"`,
    );
    return toCsv({
      title: 'Reconciliation',
      subtitle: report.regionName,
      columns: [
        { key: 'kind', label: 'Finding' },
        { key: 'institutionName', label: 'Institution' },
        { key: 'aicteId', label: 'AICTE ID' },
        { key: 'refNo', label: 'Reference' },
        { key: 'detail', label: 'Detail' },
      ],
      rows: report.rows.map((r) => ({ ...r })),
    });
  }
}
