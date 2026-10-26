import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { DiscrepanciesService } from './discrepancies.service.js';
import { DiscrepanciesController, ScrutinyController } from './scrutiny.controller.js';
import { ScrutinyService } from './scrutiny.service.js';

@Module({
  imports: [InstrumentsModule],
  controllers: [ScrutinyController, DiscrepanciesController],
  providers: [ScrutinyService, DiscrepanciesService],
  exports: [DiscrepanciesService],
})
export class ScrutinyModule {}
