import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { ForfeitureController } from './forfeiture.controller.js';
import { ForfeitureService } from './forfeiture.service.js';

@Module({
  imports: [InstrumentsModule],
  controllers: [ForfeitureController],
  providers: [ForfeitureService],
})
export class ForfeitureModule {}
