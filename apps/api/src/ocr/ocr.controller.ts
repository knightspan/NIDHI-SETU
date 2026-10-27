import { Controller, HttpCode, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../auth/decorators.js';
import { getConfig } from '../config/config.js';
import type { UploadedFile as File } from '../documents/documents.service.js';
import { InvalidInputError } from '../domain/errors.js';
import { sniffFileType } from '../domain/file-sniff.js';
import { OcrIngestService } from './ocr-ingest.service.js';

const MAX_BYTES = getConfig().DOCUMENT_MAX_MB * 1024 * 1024;

@ApiTags('ocr')
@Controller('ocr')
export class OcrController {
  constructor(private readonly ocr: OcrIngestService) {}

  /** Reads a scan and returns suggested field values for pre-filling a form. Nothing is stored. */
  @RequirePermission('document:upload')
  @Post('preview')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async preview(@UploadedFile() file: File | undefined) {
    if (!file) throw new InvalidInputError('Attach the scan in the "file" field');
    const mime = sniffFileType(file.buffer);
    if (!mime) throw new InvalidInputError('Only PDF, PNG or JPEG files are accepted');
    return this.ocr.preview(file.buffer, file.originalname, mime);
  }
}
