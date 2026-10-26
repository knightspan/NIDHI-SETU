import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { BankController } from './bank.controller.js';
import { BankService } from './bank.service.js';

@Module({
  imports: [InstrumentsModule],
  controllers: [BankController],
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
