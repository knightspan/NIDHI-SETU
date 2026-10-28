import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { TaxController } from './tax.controller.js';
import { TaxService } from './tax.service.js';

@Module({
  imports: [InstrumentsModule, BankModule],
  controllers: [TaxController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
