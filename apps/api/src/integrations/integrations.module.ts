import { Module } from '@nestjs/common';
import { AICTE_APPROVAL_ADAPTER, MockAicteApprovalAdapter } from './aicte.adapter.js';
import { IntegrationsController } from './integrations.controller.js';

@Module({
  controllers: [IntegrationsController],
  providers: [{ provide: AICTE_APPROVAL_ADAPTER, useClass: MockAicteApprovalAdapter }],
  exports: [AICTE_APPROVAL_ADAPTER],
})
export class IntegrationsModule {}
