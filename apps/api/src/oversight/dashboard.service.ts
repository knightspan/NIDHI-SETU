import { Injectable } from '@nestjs/common';
import { trustMixByRegion } from '../domain/effort.js';
import {
  HELD_STATES,
  LIFECYCLE_STATUSES,
  ROLE_SCOPE,
  VALIDITY_STATUSES,
  type DashboardData,
  type QueueItem,
} from '@nidhisetu/shared';
import { ClockService } from '../clock/clock.service.js';
import { addDays } from '../domain/dates.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PENDING_VERIFICATION = [
  'SUBMITTED',
  'UNDER_SCRUTINY',
  'DISCREPANCY_RAISED',
  'OFFICER_VERIFIED',
  'BANK_CONFIRMATION_PENDING',
] as const;

/** Dashboard KPIs, charts and the role's work queue (Section 7 · cap 8), always within scope. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async build(p: Principal): Promise<DashboardData> {
    const started = Date.now();
    const scope = instrumentScope(p) as Prisma.InstrumentWhereInput;
    const where = (w: Prisma.InstrumentWhereInput): Prisma.InstrumentWhereInput => ({
      AND: [scope, w],
    });
    const today = this.clock.today();
    const count = (w: Prisma.InstrumentWhereInput) =>
      this.prisma.instrument.count({ where: where(w) });
    const maturingWithin = (days: number) =>
      count({ status: 'ACTIVE', maturityDate: { gt: today, lte: addDays(today, days) } });

    const [statusGroups, validityGroups, held, exp30, exp60, exp90, openDisc, fraud] =
      await Promise.all([
        this.prisma.instrument.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        this.prisma.instrument.groupBy({
          by: ['validityStatus'],
          where: where({ validityStatus: { not: null } }),
          _count: { _all: true },
        }),
        this.prisma.instrument.findMany({
          where: where({ status: { in: [...HELD_STATES] } }),
          select: {
            amount: true,
            bankCode: true,
            bank: { select: { name: true } },
            trustTier: true,
            institution: { select: { regionId: true } },
          },
        }),
        maturingWithin(30),
        maturingWithin(60),
        maturingWithin(90),
        this.prisma.discrepancy.count({
          where: { status: { in: ['OPEN', 'RESPONDED'] }, instrument: scope },
        }),
        this.prisma.discrepancy.count({
          where: {
            status: { in: ['OPEN', 'RESPONDED'] },
            ruleCode: 'DUPLICATE_FDR',
            instrument: scope,
          },
        }),
      ]);

    const byStatusMap = new Map(statusGroups.map((g) => [g.status, g._count._all]));
    const byValidityMap = new Map(validityGroups.map((g) => [g.validityStatus, g._count._all]));
    const s = (k: (typeof LIFECYCLE_STATUSES)[number]) => byStatusMap.get(k) ?? 0;

    const regions = await this.prisma.region.findMany({ select: { id: true, name: true } });
    const regionName = new Map(regions.map((r) => [r.id, r.name]));
    const regionAgg = new Map<string, { count: number; amount: number }>();
    const bankAgg = new Map<string, { name: string; count: number; amount: number }>();
    let heldAmount = 0;
    for (const h of held) {
      const amt = Number(h.amount ?? 0);
      heldAmount += amt;
      const r = regionAgg.get(h.institution.regionId) ?? { count: 0, amount: 0 };
      r.count++;
      r.amount += amt;
      regionAgg.set(h.institution.regionId, r);
      const code = h.bankCode ?? '—';
      const b = bankAgg.get(code) ?? { name: h.bank?.name ?? code, count: 0, amount: 0 };
      b.count++;
      b.amount += amt;
      bankAgg.set(code, b);
    }

    return {
      today: this.clock.todayIso(),
      scope: ROLE_SCOPE[p.role],
      kpis: {
        heldCount: held.length,
        heldAmount: heldAmount.toFixed(2),
        active: s('ACTIVE'),
        expiring30: exp30,
        expiring60: exp60,
        expiring90: exp90,
        matured: byValidityMap.get('MATURED') ?? 0,
        overdue: byValidityMap.get('OVERDUE_RENEWAL') ?? 0,
        renewed: s('RENEWED'),
        released: s('RELEASED'),
        pendingVerification: PENDING_VERIFICATION.reduce((n, k) => n + s(k), 0),
        openDiscrepancies: openDisc,
        fraudSignals: fraud,
      },
      byStatus: LIFECYCLE_STATUSES.map((status) => ({ status, count: s(status) })).filter(
        (x) => x.count > 0,
      ),
      byValidity: VALIDITY_STATUSES.map((validity) => ({
        validity,
        count: byValidityMap.get(validity) ?? 0,
      })),
      byRegion: [...regionAgg.entries()]
        .map(([regionId, v]) => ({
          regionId,
          name: regionName.get(regionId) ?? '—',
          count: v.count,
          amount: v.amount.toFixed(2),
        }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      byBank: [...bankAgg.entries()]
        .map(([code, v]) => ({ code, name: v.name, count: v.count, amount: v.amount.toFixed(2) }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      queue: await this.queue(p, scope, s, byValidityMap.get('OVERDUE_RENEWAL') ?? 0, fraud),
      trustMix: trustMixByRegion(
        held.map((h) => ({
          region: regionName.get(h.institution.regionId) ?? '—',
          tier: h.trustTier,
          count: 1,
        })),
      ),
      generatedInMs: Date.now() - started,
    };
  }

  private async queue(
    p: Principal,
    scope: Prisma.InstrumentWhereInput,
    s: (k: (typeof LIFECYCLE_STATUSES)[number]) => number,
    overdue: number,
    fraud: number,
  ): Promise<QueueItem[]> {
    const escalations = () =>
      this.prisma.escalation.count({ where: { toRole: p.role, resolvedAt: null } });
    const responded = () =>
      this.prisma.discrepancy.count({ where: { status: 'RESPONDED', instrument: scope } });
    switch (p.role) {
      case 'INSTITUTION_USER':
        return [
          { key: 'drafts', count: s('DRAFT'), href: '/instruments?status=DRAFT' },
          {
            key: 'discrepancyRaised',
            count: s('DISCREPANCY_RAISED'),
            href: '/instruments?status=DISCREPANCY_RAISED',
            urgent: true,
          },
          {
            key: 'renewalsDue',
            count: await this.prisma.instrument.count({
              where: {
                AND: [
                  scope,
                  {
                    status: 'ACTIVE',
                    validityStatus: { in: ['EXPIRING_SOON', 'MATURED', 'OVERDUE_RENEWAL'] },
                  },
                ],
              },
            }),
            href: '/renewals',
            urgent: overdue > 0,
          },
          {
            key: 'releasesInProgress',
            count: s('RELEASE_REQUESTED') + s('RELEASE_RECOMMENDED') + s('RELEASE_APPROVED'),
            href: '/releases',
          },
        ];
      case 'RO_OFFICER':
        return [
          {
            key: 'awaitingScrutiny',
            count: s('SUBMITTED') + s('UNDER_SCRUTINY'),
            href: '/scrutiny',
          },
          { key: 'responsesToReview', count: await responded(), href: '/discrepancies?open=true' },
          {
            key: 'readyForBank',
            count: s('OFFICER_VERIFIED'),
            href: '/instruments?status=OFFICER_VERIFIED',
          },
          {
            key: 'awaitingBank',
            count: s('BANK_CONFIRMATION_PENDING'),
            href: '/instruments?status=BANK_CONFIRMATION_PENDING',
          },
          { key: 'releaseRequests', count: s('RELEASE_REQUESTED'), href: '/releases' },
          {
            key: 'overdueRenewals',
            count: overdue,
            href: '/instruments?validity=OVERDUE_RENEWAL',
            urgent: overdue > 0,
          },
          { key: 'escalations', count: await escalations(), href: '/escalations', urgent: true },
        ];
      case 'BUREAU_OFFICER':
        return [
          { key: 'releaseRequests', count: s('RELEASE_REQUESTED'), href: '/releases' },
          {
            key: 'fraudSignals',
            count: fraud,
            href: '/discrepancies?ruleCode=DUPLICATE_FDR',
            urgent: fraud > 0,
          },
          {
            key: 'overdueRenewals',
            count: overdue,
            href: '/instruments?validity=OVERDUE_RENEWAL',
            urgent: overdue > 0,
          },
          { key: 'escalations', count: await escalations(), href: '/escalations', urgent: true },
        ];
      case 'COMPETENT_AUTHORITY':
        return [
          { key: 'releasesAwaitingDecision', count: s('RELEASE_RECOMMENDED'), href: '/releases' },
          { key: 'escalations', count: await escalations(), href: '/escalations', urgent: true },
        ];
      case 'FINANCE_OFFICER':
        return [
          { key: 'releasesAwaitingExecution', count: s('RELEASE_APPROVED'), href: '/releases' },
        ];
      case 'BANK_OFFICER': {
        const pending = await this.prisma.bankConfirmationRequest.count({
          where: { bankId: p.bankId ?? undefined, status: { in: ['PENDING', 'FAILED'] } },
        });
        const late = await this.prisma.bankConfirmationRequest.count({
          where: {
            bankId: p.bankId ?? undefined,
            status: { in: ['PENDING', 'FAILED'] },
            slaDueAt: { lt: this.clock.now() },
          },
        });
        return [
          { key: 'bankPending', count: pending, href: '/bank-desk' },
          { key: 'bankOverdue', count: late, href: '/bank-desk', urgent: late > 0 },
        ];
      }
      case 'AUDITOR':
        return [
          {
            key: 'fraudSignals',
            count: fraud,
            href: '/discrepancies?ruleCode=DUPLICATE_FDR',
            urgent: fraud > 0,
          },
          { key: 'auditEvents', count: await this.prisma.auditEvent.count(), href: '/audit' },
        ];
      case 'SYS_ADMIN':
        return [
          {
            key: 'users',
            count: await this.prisma.user.count({ where: { active: true } }),
            href: '/admin/users',
          },
          {
            key: 'placeholderRules',
            count: (
              await this.prisma.rule.findMany({
                select: { code: true, source: true },
                orderBy: { version: 'desc' },
              })
            )
              .filter((r, i, all) => all.findIndex((x) => x.code === r.code) === i)
              .filter((r) => r.source.startsWith('ASSUMPTION')).length,
            href: '/admin/rules',
            urgent: true,
          },
          { key: 'auditEvents', count: await this.prisma.auditEvent.count(), href: '/audit' },
        ];
    }
  }
}
