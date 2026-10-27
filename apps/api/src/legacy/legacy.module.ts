import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { LegacyController } from './legacy.controller.js';
import { LegacyService } from './legacy.service.js';

@Module({
  imports: [InstrumentsModule],
  controllers: [LegacyController],
  providers: [LegacyService],
})
export class LegacyModule {}
