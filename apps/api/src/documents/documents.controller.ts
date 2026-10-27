import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UploadDocumentSchema } from '@nidhisetu/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, RequirePermission } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.js';
import { getConfig } from '../config/config.js';
import { InvalidInputError } from '../domain/errors.js';
import type { Principal } from '../domain/scope.js';
import { DocumentsService, type UploadedFile as File } from './documents.service.js';

const MAX_BYTES = getConfig().DOCUMENT_MAX_MB * 1024 * 1024;
const UrlQuery = z.object({ inline: z.enum(['true', 'false']).default('false') });

@ApiTags('documents')
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermission('document:upload')
  @Post('instruments/:id/documents')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: [...UploadDocumentSchema.shape.type.options] },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: File | undefined,
    @Body(new ZodPipe(UploadDocumentSchema)) body: z.infer<typeof UploadDocumentSchema>,
  ) {
    if (!file) throw new InvalidInputError('Attach a file in the "file" field');
    const { doc, ocr } = await this.documents.uploadForInstrument(user, id, body.type, file);
    return { id: doc.id, version: doc.version, sha256: doc.sha256, mimeType: doc.mimeType, ocr };
  }

  /** Short-lived signed link for preview (inline) or download. */
  @RequirePermission('document:read')
  @Get('documents/:id/url')
  url(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(UrlQuery)) q: z.infer<typeof UrlQuery>,
  ) {
    return this.documents.signedUrl(user, id, q.inline === 'true');
  }

  /** Authorised by the signed token itself, so it works in <img>/<iframe> previews. */
  @Public()
  @Get('documents/download')
  async download(@Query('token') token: string, @Res() res: Response): Promise<void> {
    const { doc, body, inline } = await this.documents.download(token ?? '');
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', body.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.originalName)}"`,
    );
    // Allow the web app (same site) to show PDFs/images in an iframe.
    res.removeHeader('X-Frame-Options');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    );
    res.end(body);
  }
}
