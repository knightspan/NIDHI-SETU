import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ROLE_SCOPE, type Role } from '@nidhisetu/shared';
import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type Db } from '../prisma/prisma.service.js';
import { MailService } from './mail.service.js';
import { SMS_ADAPTER, type SmsAdapter } from './sms.adapter.js';

export type NotificationKind =
  | 'SUBMISSION'
  | 'DISCREPANCY'
  | 'RESPONSE'
  | 'BANK'
  | 'ACTIVATED'
  | 'REMINDER'
  | 'ESCALATION'
  | 'RENEWAL'
  | 'RELEASE'
  | 'DIGEST'
  | 'SYSTEM';

export interface NotificationMessage {
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  instrumentId?: string | null;
  /** Also send an SMS (escalations, urgent reminders). */
  sms?: boolean;
  /** Skip email (in-app only). */
  inAppOnly?: boolean;
}

export interface InstrumentScopeRef {
  institutionId: string;
  regionId: string;
  bankId: string | null;
}

const FLUSH_BATCH = 200;

/**
 * In-app notifications with an email outbox (Section 7 · cap 7). Rows are written in the caller's
 * transaction; emails are sent afterwards by `flush()`, so a rolled-back change never emails anyone.
 */
@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly mail: MailService,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleDestroy(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  /** Users holding `roles` who are in scope for an instrument (own institution / region / bank, or national). */
  async usersFor(db: Db, roles: readonly Role[], ref?: InstrumentScopeRef): Promise<string[]> {
    const or: Prisma.UserWhereInput[] = [];
    for (const role of roles) {
      switch (ROLE_SCOPE[role]) {
        case 'INSTITUTION':
          if (ref) or.push({ role, institutionId: ref.institutionId });
          break;
        case 'REGION':
          if (ref) or.push({ role, regionId: ref.regionId });
          break;
        case 'BANK':
          if (ref?.bankId) or.push({ role, bankId: ref.bankId });
          break;
        case 'NATIONAL':
        case 'NONE':
          or.push({ role });
      }
    }
    if (or.length === 0) return [];
    const users = await db.user.findMany({ where: { active: true, OR: or }, select: { id: true } });
    return users.map((u) => u.id);
  }

  async scopeOf(db: Db, instrumentId: string): Promise<InstrumentScopeRef> {
    const i = await db.instrument.findUniqueOrThrow({
      where: { id: instrumentId },
      select: { institutionId: true, bankId: true, institution: { select: { regionId: true } } },
    });
    return { institutionId: i.institutionId, regionId: i.institution.regionId, bankId: i.bankId };
  }

  /**
   * Bulk imports (the demo seed) replay years of history; notifications about events before this
   * instant would only flood inboxes with stale items, so they are not created.
   */
  quietBefore: Date | null = null;

  private quiet(): boolean {
    return this.quietBefore !== null && this.clock.now() < this.quietBefore;
  }

  /** Notifies the in-scope holders of `roles` about an instrument. */
  async notifyInstrument(
    db: Db,
    instrumentId: string,
    roles: readonly Role[],
    msg: NotificationMessage,
  ): Promise<number> {
    if (this.quiet()) return 0;
    const userIds = await this.usersFor(db, roles, await this.scopeOf(db, instrumentId));
    return this.notifyUsers(db, userIds, {
      ...msg,
      instrumentId,
      link: msg.link ?? `/instruments/${instrumentId}`,
    });
  }

  async notifyUsers(db: Db, userIds: readonly string[], msg: NotificationMessage): Promise<number> {
    if (this.quiet()) return 0;
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return 0;
    const email = this.mail.enabled && !msg.inAppOnly;
    const now = this.clock.now();
    await db.notification.createMany({
      data: unique.map((userId) => ({
        userId,
        kind: msg.kind,
        title: msg.title.slice(0, 200),
        body: msg.body.slice(0, 4000),
        link: msg.link ?? null,
        instrumentId: msg.instrumentId ?? null,
        channels: ['IN_APP', ...(email ? ['EMAIL'] : []), ...(msg.sms ? ['SMS'] : [])],
        emailStatus: email ? 'PENDING' : 'SKIPPED',
        createdAt: now,
      })),
    });
    if (msg.sms) {
      const phones = await db.user.findMany({
        where: { id: { in: unique }, phone: { not: null } },
        select: { phone: true },
      });
      for (const p of phones)
        await this.sms.send(p.phone!, `${msg.title}: ${msg.body}`.slice(0, 300));
    }
    if (email) this.flushSoon();
    return unique.length;
  }

  /** Many messages at once (jobs): one bulk insert instead of one per message. */
  async notifyBulk(
    db: Db,
    items: { userIds: readonly string[]; msg: NotificationMessage }[],
  ): Promise<number> {
    if (this.quiet()) return 0;
    const email = this.mail.enabled;
    const now = this.clock.now();
    const rows: Prisma.NotificationCreateManyInput[] = [];
    const smsTargets = new Map<string, string>();
    for (const { userIds, msg } of items) {
      const wantsEmail = email && !msg.inAppOnly;
      for (const userId of new Set(userIds)) {
        rows.push({
          userId,
          kind: msg.kind,
          title: msg.title.slice(0, 200),
          body: msg.body.slice(0, 4000),
          link: msg.link ?? null,
          instrumentId: msg.instrumentId ?? null,
          channels: ['IN_APP', ...(wantsEmail ? ['EMAIL'] : []), ...(msg.sms ? ['SMS'] : [])],
          emailStatus: wantsEmail ? 'PENDING' : 'SKIPPED',
          createdAt: now,
        });
        if (msg.sms) smsTargets.set(userId, `${msg.title}: ${msg.body}`.slice(0, 300));
      }
    }
    for (let i = 0; i < rows.length; i += 5_000) {
      await db.notification.createMany({ data: rows.slice(i, i + 5_000) });
    }
    if (smsTargets.size) {
      const phones = await db.user.findMany({
        where: { id: { in: [...smsTargets.keys()] }, phone: { not: null } },
        select: { id: true, phone: true },
      });
      for (const p of phones) await this.sms.send(p.phone!, smsTargets.get(p.id)!);
    }
    if (rows.some((r) => r.emailStatus === 'PENDING')) this.flushSoon();
    return rows.length;
  }

  /** Schedules an outbox flush shortly after the current transaction is likely committed. */
  flushSoon(): void {
    if (this.flushTimer || !this.mail.enabled) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 300);
    this.flushTimer.unref();
  }

  /** Sends pending emails. Safe to call concurrently and repeatedly. */
  async flush(): Promise<{ sent: number; failed: number }> {
    if (this.flushing || !this.mail.enabled) return { sent: 0, failed: 0 };
    this.flushing = true;
    let sent = 0;
    let failed = 0;
    try {
      for (;;) {
        const batch = await this.prisma.notification.findMany({
          where: { emailStatus: 'PENDING' },
          include: { user: { select: { email: true } } },
          orderBy: { createdAt: 'asc' },
          take: FLUSH_BATCH,
        });
        if (batch.length === 0) break;
        for (const n of batch) {
          try {
            await this.mail.send({
              to: n.user.email,
              subject: `[NidhiSetu] ${n.title}`,
              text: this.emailText(n.body, n.link),
            });
            await this.prisma.notification.update({
              where: { id: n.id },
              data: { emailStatus: 'SENT' },
            });
            sent++;
          } catch (e) {
            failed++;
            await this.prisma.notification.update({
              where: { id: n.id },
              data: {
                emailStatus: 'FAILED',
                emailError: e instanceof Error ? e.message.slice(0, 300) : 'error',
              },
            });
          }
        }
        if (batch.length < FLUSH_BATCH) break;
      }
    } finally {
      this.flushing = false;
    }
    if (failed) this.logger.warn(`email outbox: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  }

  private emailText(body: string, link: string | null): string {
    return link ? `${body}\n\nOpen in NidhiSetu: ${this.config.WEB_ORIGIN}${link}` : body;
  }
}
