import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { actorOf } from '../common/actor.js';
import { ZodPipe } from '../common/zod.js';
import type { UploadedFile as File } from '../documents/documents.service.js';
import type { Principal } from '../domain/scope.js';
import { TaxService } from './tax.service.js';

const OverviewQuery = z.object({ institutionId: z.uuid().optional() });

@ApiTags('tax')
@Controller()
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  /** AIS requests and uploads (institutions: their own; officers: pass institutionId). */
  @RequirePermission('instrument:read')
  @Get('tax/ais')
  overview(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(OverviewQuery)) q: z.infer<typeof OverviewQuery>,
  ) {
    return this.tax.overview(u, q.institutionId);
  }

  @RequirePermission('tax:upload')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('tax/ais')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  upload(@CurrentUser() u: Principal, @UploadedFile() file: File | undefined) {
    return this.tax.upload(u, file);
  }

  /** Demo-clock-aware manual trigger of the yearly AIS request job. */
  @RequirePermission('clock:manage')
  @Post('admin/jobs/ais-requests')
  @HttpCode(200)
  run(@CurrentUser() u: Principal) {
    return this.tax.requestAis(actorOf(u));
  }
}
