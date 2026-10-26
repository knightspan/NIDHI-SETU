import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { InstitutionsService } from './institutions.service.js';
import { MetricsService } from './metrics.service.js';
import { OversightController } from './oversight.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  controllers: [OversightController],
  providers: [DashboardService, InstitutionsService, MetricsService, ReportsService],
  exports: [InstitutionsService],
})
export class OversightModule {}
