import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { ReleasesController } from './releases.controller.js';
import { ReleasesService } from './releases.service.js';

@Module({
  imports: [InstrumentsModule],
  controllers: [ReleasesController],
  providers: [ReleasesService],
})
export class ReleasesModule {}
