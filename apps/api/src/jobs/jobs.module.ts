import { BankModule } from '../bank/bank.module.js';
import { InstrumentsModule } from '../instruments/instruments.module.js';
import { TaxModule } from '../tax/tax.module.js';
import { InjectQueue, BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { getConfig } from '../config/config.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DigestService } from './digest.service.js';
import { EscalationsController, JobsAdminController } from './jobs.controller.js';
import { LifecycleService } from './lifecycle.service.js';

export const MAINTENANCE_QUEUE = 'maintenance';

/** BullMQ worker: runs the scheduled jobs (only when QUEUE_ENABLED and Redis is configured). */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly lifecycle: LifecycleService,
    private readonly digest: DigestService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'lifecycle':
        return this.lifecycle.run('schedule');
      case 'digest':
        return this.digest.run();
      case 'email-outbox':
        return this.notifications.flush();
      default:
        this.logger.warn(`unknown job ${job.name}`);
        return null;
    }
  }
}

/** Registers the repeatable schedules (idempotent upserts). Times are India Standard Time. */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobScheduler.name);

  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'daily-lifecycle',
      { pattern: '30 0 * * *', tz: 'Asia/Kolkata' },
      { name: 'lifecycle' },
    );
    await this.queue.upsertJobScheduler(
      'daily-digest',
      { pattern: '0 8 * * *', tz: 'Asia/Kolkata' },
      { name: 'digest' },
    );
    await this.queue.upsertJobScheduler(
      'email-outbox',
      { every: 60_000 },
      { name: 'email-outbox' },
    );
    this.logger.log(
      'job schedules registered: lifecycle 00:30 IST, digest 08:00 IST, email outbox every minute',
    );
  }
}

/** BullMQ in native ESM needs a constructed ioredis client (workers require maxRetriesPerRequest: null). */
export function redisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}

@Module({})
export class JobsModule {
  static register(): DynamicModule {
    const cfg = getConfig();
    const base = {
      module: JobsModule,
      imports: [InstrumentsModule, BankModule, TaxModule],
      controllers: [JobsAdminController, EscalationsController],
      providers: [LifecycleService, DigestService],
      exports: [LifecycleService, DigestService],
    };
    if (!cfg.QUEUE_ENABLED || !cfg.REDIS_URL) return base;
    return {
      ...base,
      imports: [
        ...base.imports,
        BullModule.forRoot({ connection: redisConnection(cfg.REDIS_URL) }),
        BullModule.registerQueue({ name: MAINTENANCE_QUEUE }),
      ],
      providers: [...base.providers, MaintenanceProcessor, JobScheduler],
    };
  }
}
