import { Injectable } from '@nestjs/common';
import type { Role } from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { SYSTEM_ACTOR } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { addDays } from '../domain/dates.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DIGEST_ROLES: Role[] = [
  'RO_OFFICER',
  'BUREAU_OFFICER',
  'COMPETENT_AUTHORITY',
  'FINANCE_OFFICER',
  'BANK_OFFICER',
];
const LAST_KEY = 'digest_last_date';

/** Daily digest email per officer: what is waiting for them today (Section 7 · cap 7). */
@Injectable()
export class DigestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Lines of "count · label" for one officer; empty when nothing is waiting. */
  async linesFor(p: Principal): Promise<string[]> {
    const scope = instrumentScope(p) as Prisma.InstrumentWhereInput;
    const count = (where: Prisma.InstrumentWhereInput) =>
      this.prisma.instrument.count({ where: { AND: [scope, where] } });
    const today = this.clock.today();
    const lines: [number, string][] = [];
    switch (p.role) {
      case 'RO_OFFICER':
        lines.push([
          await count({ status: { in: ['SUBMITTED', 'UNDER_SCRUTINY'] } }),
          'instruments awaiting scrutiny',
        ]);
        lines.push([
          await this.prisma.discrepancy.count({
            where: { status: 'RESPONDED', instrument: scope },
          }),
          'discrepancy responses to review',
        ]);
        lines.push([
          await count({ status: 'OFFICER_VERIFIED' }),
          'verified instruments not yet sent to the bank',
        ]);
        lines.push([
          await count({ status: 'RELEASE_REQUESTED' }),
          'release requests awaiting recommendation',
        ]);
        lines.push([
          await count({ status: 'ACTIVE', maturityDate: { gt: today, lte: addDays(today, 30) } }),
          'deposits maturing within 30 days',
        ]);
        lines.push([
          await count({ validityStatus: 'OVERDUE_RENEWAL' }),
          'deposits overdue for renewal',
        ]);
        break;
      case 'BUREAU_OFFICER':
        lines.push([
          await count({ status: 'RELEASE_REQUESTED' }),
          'release requests awaiting recommendation',
        ]);
        lines.push([
          await count({ validityStatus: 'OVERDUE_RENEWAL' }),
          'deposits overdue for renewal (national)',
        ]);
        lines.push([
          await this.prisma.discrepancy.count({
            where: { status: 'OPEN', ruleCode: 'DUPLICATE_FDR' },
          }),
          'open duplicate-FDR fraud signals',
        ]);
        break;
      case 'COMPETENT_AUTHORITY':
        lines.push([
          await count({ status: 'RELEASE_RECOMMENDED' }),
          'releases awaiting your decision',
        ]);
        break;
      case 'FINANCE_OFFICER':
        lines.push([
          await count({ status: 'RELEASE_APPROVED' }),
          'approved releases awaiting execution',
        ]);
        break;
      case 'BANK_OFFICER':
        lines.push([
          await this.prisma.bankConfirmationRequest.count({
            where: { bankId: p.bankId ?? undefined, status: { in: ['PENDING', 'FAILED'] } },
          }),
          'confirmation requests awaiting your answer',
        ]);
        break;
      default:
        break;
    }
    lines.push([
      await this.prisma.escalation.count({
        where: {
          toRole: p.role,
          resolvedAt: null,
          ...(p.role === 'RO_OFFICER' ? { instrumentId: { not: null } } : {}),
        },
      }),
      'open escalations addressed to your role',
    ]);
    return lines.filter(([n]) => n > 0).map(([n, label]) => `• ${n} ${label}`);
  }

  /** Sends today's digests (once per simulated day unless forced). */
  async run(force = false): Promise<{ sent: number; skipped: boolean }> {
    await this.clock.sync(true);
    const today = this.clock.todayIso();
    const last = await this.prisma.systemSetting.findUnique({ where: { key: LAST_KEY } });
    if (!force && (last?.value as { date?: string } | undefined)?.date === today)
      return { sent: 0, skipped: true };

    const users = await this.prisma.user.findMany({
      where: { active: true, role: { in: DIGEST_ROLES } },
      select: {
        id: true,
        role: true,
        regionId: true,
        institutionId: true,
        bankId: true,
        name: true,
      },
    });
    let sent = 0;
    for (const u of users) {
      const lines = await this.linesFor(u);
      if (lines.length === 0) continue;
      sent += await this.notifications.notifyUsers(this.prisma, [u.id], {
        kind: 'DIGEST',
        title: `Daily digest for ${today}`,
        body: `Good morning ${u.name},\n\nWaiting for you in NidhiSetu today:\n${lines.join('\n')}`,
        link: '/dashboard',
      });
    }
    await this.prisma.systemSetting.upsert({
      where: { key: LAST_KEY },
      create: { key: LAST_KEY, value: { date: today } },
      update: { value: { date: today } },
    });
    await this.audit.record({
      actor: SYSTEM_ACTOR,
      action: 'digest.sent',
      entityType: 'Job',
      data: { date: today, sent },
    });
    return { sent, skipped: false };
  }
}
