import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { REPO_ROOT, getConfig } from '../config/config.js';
import path from 'node:path';
import { DiscrepancyEngine } from '../discrepancies/discrepancy-engine.service.js';
import { DocumentsController } from '../documents/documents.controller.js';
import { DocumentsService } from '../documents/documents.service.js';
import { OcrController } from '../ocr/ocr.controller.js';
import { OcrClient } from '../ocr/ocr.client.js';
import { OcrIngestService } from '../ocr/ocr-ingest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DbStorageAdapter,
  FsStorageAdapter,
  S3StorageAdapter,
  STORAGE_ADAPTER,
} from '../storage/storage.adapter.js';
import { AssertionsService } from './assertions.service.js';
import { InstrumentsController } from './instruments.controller.js';
import { InstrumentsService } from './instruments.service.js';
import { TransitionsService } from './transitions.service.js';
import { TrinetraService } from './trinetra.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [InstrumentsController, DocumentsController, OcrController],
  providers: [
    InstrumentsService,
    AssertionsService,
    TransitionsService,
    TrinetraService,
    DocumentsService,
    DiscrepancyEngine,
    OcrClient,
    OcrIngestService,
    {
      provide: STORAGE_ADAPTER,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const c = getConfig();
        if (c.STORAGE_DRIVER === 'db') return new DbStorageAdapter(prisma);
        return c.STORAGE_DRIVER === 's3'
          ? new S3StorageAdapter({
              endpoint: c.S3_ENDPOINT,
              region: c.S3_REGION,
              bucket: c.S3_BUCKET,
              accessKeyId: c.S3_ACCESS_KEY,
              secretAccessKey: c.S3_SECRET_KEY,
              forcePathStyle: c.S3_FORCE_PATH_STYLE,
            })
          : new FsStorageAdapter(path.resolve(REPO_ROOT, c.STORAGE_FS_ROOT ?? '.data/objects'));
      },
    },
  ],
  exports: [
    InstrumentsService,
    AssertionsService,
    TransitionsService,
    TrinetraService,
    DocumentsService,
    DiscrepancyEngine,
    OcrClient,
    OcrIngestService,
    STORAGE_ADAPTER,
  ],
})
export class InstrumentsModule {}
