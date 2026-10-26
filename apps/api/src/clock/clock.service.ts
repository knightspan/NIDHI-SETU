import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DAY_MS, dateOnly, istDateIso } from '../domain/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SETTING_KEY = 'demo_clock';
const REFRESH_MS = 2_000;

interface DemoClockSetting {
  offsetDays: number;
}

/**
 * The single source of "now" (Section 3.6). In DEMO_MODE an admin can shift "today" by whole days;
 * every rule, job, timestamp and dashboard reads time from here.
 */
@Injectable()
export class ClockService {
  private offsetDays = 0;
  private loadedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get demoMode(): boolean {
    return this.config.DEMO_MODE;
  }

  /** Re-reads the offset if stale. Called per request and at the start of each job. */
  async sync(force = false): Promise<void> {
    if (!this.demoMode) {
      this.offsetDays = 0;
      return;
    }
    if (!force && Date.now() - this.loadedAt < REFRESH_MS) return;
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
    this.offsetDays = (row?.value as DemoClockSetting | undefined)?.offsetDays ?? 0;
    this.loadedAt = Date.now();
  }

  /** Current instant (real time + demo offset). */
  now(): Date {
    return new Date(Date.now() + this.offsetDays * DAY_MS);
  }

  /** Today's IST calendar date as YYYY-MM-DD. */
  todayIso(): string {
    return istDateIso(this.now());
  }

  /** Today as a UTC-midnight Date, comparable with @db.Date columns. */
  today(): Date {
    return dateOnly(this.todayIso());
  }

  get offset(): number {
    return this.offsetDays;
  }

  /** Sets the simulated "today". Returns the new offset in days. */
  async setToday(isoDate: string, actorId: string | null): Promise<number> {
    if (!this.demoMode)
      throw new ForbiddenException('The demo clock is disabled (DEMO_MODE=false)');
    const realToday = dateOnly(istDateIso(new Date()));
    const offsetDays = Math.round((dateOnly(isoDate).getTime() - realToday.getTime()) / DAY_MS);
    await this.prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: { offsetDays }, updatedById: actorId },
      update: { value: { offsetDays }, updatedById: actorId },
    });
    await this.sync(true);
    return offsetDays;
  }
}
