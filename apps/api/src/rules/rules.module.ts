import { Global, Module } from '@nestjs/common';
import { RulesService } from './rules.service.js';

@Global()
@Module({
  providers: [RulesService],
  exports: [RulesService],
})
export class RulesModule {}
