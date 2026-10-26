import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  BankRequestListQuerySchema,
  BankResponseSchema,
  type BankRequestListQuery,
} from '@nidhisetu/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod.js';
import { getConfig } from '../config/config.js';
import { InvalidInputError } from '../domain/errors.js';
import type { Principal } from '../domain/scope.js';
import type { UploadedFile as File } from '../documents/documents.service.js';
import { BankService } from './bank.service.js';

const RespondSchema = z.intersection(
  BankResponseSchema,
  z.object({ letterDocumentId: z.uuid().optional() }),
);
type RespondBody = z.infer<typeof RespondSchema>;
const MAX_BYTES = getConfig().DOCUMENT_MAX_MB * 1024 * 1024;

@ApiTags('bank')
@Controller()
export class BankController {
  constructor(private readonly bank: BankService) {}

  /** Regional officer sends an officer-verified instrument to its bank. */
  @RequirePermission('bank:request')
  @Post('instruments/:id/send-to-bank')
  @HttpCode(200)
  sendToBank(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.bank.sendToBank(u, id);
  }

  @RequirePermission('bank:request')
  @Post('bank-requests/:id/retry')
  @HttpCode(200)
  retry(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.bank.retry(u, id);
  }

  /** Bank Confirmation Desk: only requests addressed to the officer's own bank. */
  @RequirePermission('bank:respond')
  @Get('bank-requests')
  @ApiZodQuery(BankRequestListQuerySchema)
  list(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(BankRequestListQuerySchema)) q: BankRequestListQuery,
  ) {
    return this.bank.list(u, q);
  }

  @RequirePermission('bank:respond')
  @Get('bank-requests/:id')
  get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.bank.get(u, id);
  }

  @RequirePermission('bank:respond')
  @Post('bank-requests/:id/letter')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  uploadLetter(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: File | undefined,
  ) {
    if (!file) throw new InvalidInputError('Attach the signed letter in the "file" field');
    return this.bank.uploadLetter(u, id, file);
  }

  @RequirePermission('bank:respond')
  @Post('bank-requests/:id/respond')
  @HttpCode(200)
  @ApiZodBody(RespondSchema)
  respond(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RespondSchema)) body: RespondBody,
  ) {
    const { letterDocumentId, ...response } = body;
    return this.bank.respond(u, id, response, letterDocumentId);
  }
}
