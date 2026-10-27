import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { InstrumentsModule } from './instruments/instruments.module.js';
import { ScrutinyModule } from './discrepancies/scrutiny.module.js';
import { AuditModule } from './audit/audit.module.js';
import { BankModule } from './bank/bank.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CsrfMiddleware } from './auth/csrf.middleware.js';
import { JwtAuthGuard, PermissionsGuard } from './auth/guards.js';
import { ClockSyncInterceptor } from './clock/clock.interceptor.js';
import { ClockModule } from './clock/clock.module.js';
import { AllExceptionsFilter } from './common/exception.filter.js';
import { getConfig } from './config/config.js';
import { ConfigModule } from './config/config.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { RulesController } from './rules/rules.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { LegacyModule } from './legacy/legacy.module.js';
import { OversightModule } from './oversight/oversight.module.js';
import { ReleasesModule } from './releases/releases.module.js';
import { RulesModule } from './rules/rules.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ClockModule,
    AuditModule,
    RulesModule,
    NotificationsModule,
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const cfg = getConfig();
        return {
          throttlers: [{ name: 'default', ttl: 60_000, limit: cfg.RATE_LIMIT_PER_MINUTE }],
          skipIf: () => cfg.NODE_ENV === 'test',
        };
      },
    }),
    AuthModule,
    AdminModule,
    InstrumentsModule,
    ScrutinyModule,
    BankModule,
    ReleasesModule,
    OversightModule,
    LegacyModule,
    IntegrationsModule,
    JobsModule.register(),
  ],
  controllers: [HealthController, RulesController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ClockSyncInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfMiddleware).forRoutes('*path');
  }
}
