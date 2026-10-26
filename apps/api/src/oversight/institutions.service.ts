import { Injectable } from '@nestjs/common';
import {
  HELD_STATES,
  type InstitutionListQuery,
  type InstitutionStatementView,
  type InstitutionSummaryView,
  type Paged,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { actorOf } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { requiredAmount } from '../domain/discrepancy-rules.js';
import { NotFoundError } from '../domain/errors.js';
import { institutionScope, instrumentScope, type Principal } from '../domain/scope.js';
import type { Institution, Prisma } from '../generated/prisma/client.js';
import { SUMMARY_INCLUDE, toSummary } from '../instruments/instrument-views.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';

type InstitutionRow = Institution & { region: { name: string } };

/** Institution repository and compliance statement (Section 7 · cap 1 & 8). */
@Injectable()
export class InstitutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: RulesService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  /** Held deposits, requirement and compliance for many institutions at once. */
  async summarize(rows: InstitutionRow[]): Promise<InstitutionSummaryView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const rules = await this.rules.current();
    const today = this.clock.today();
    const [held, disc] = await Promise.all([
      this.prisma.instrument.groupBy({
        by: ['institutionId'],
        where: { institutionId: { in: ids }, status: { in: [...HELD_STATES] } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.instrument.findMany({
        where: { institutionId: { in: ids } },
        select: {
          institutionId: true,
          _count: {
            select: { discrepancies: { where: { status: { in: ['OPEN', 'RESPONDED'] } } } },
          },
        },
      }),
    ]);
    const heldBy = new Map(
      held.map((h) => [
        h.institutionId,
        { amount: Number(h._sum.amount ?? 0), count: h._count._all },
      ]),
    );
    const discBy = new Map<string, number>();
    for (const d of disc)
      discBy.set(d.institutionId, (discBy.get(d.institutionId) ?? 0) + d._count.discrepancies);
    return rows.map((r) => {
      const req = requiredAmount(
        r,
        rules['eligibility.exemption'],
        rules['amount.required'],
        today,
      );
      const h = heldBy.get(r.id) ?? { amount: 0, count: 0 };
      return {
        id: r.id,
        aicteId: r.aicteId,
        name: r.name,
        trustName: r.trustName,
        regionName: r.region.name,
        state: r.state,
        yearEstablished: r.yearEstablished,
        programmes: r.programmes,
        heldCount: h.count,
        heldAmount: h.amount.toFixed(2),
        required: req.required.toFixed(2),
        exempt: req.exempt,
        compliant: req.exempt || h.amount >= req.required,
        openDiscrepancies: discBy.get(r.id) ?? 0,
      };
    });
  }

  async list(p: Principal, q: InstitutionListQuery): Promise<Paged<InstitutionSummaryView>> {
    const where: Prisma.InstitutionWhereInput = {
      AND: [
        institutionScope(p),
        q.regionId ? { regionId: q.regionId } : {},
        q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { aicteId: { contains: q.q, mode: 'insensitive' } },
                { trustName: { contains: q.q, mode: 'insensitive' } },
                { state: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const rows = await this.prisma.institution.findMany({
      where,
      include: { region: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    let items = await this.summarize(rows);
    if (q.compliance === 'exempt') items = items.filter((i) => i.exempt);
    if (q.compliance === 'compliant') items = items.filter((i) => i.compliant && !i.exempt);
    if (q.compliance === 'shortfall') items = items.filter((i) => !i.compliant);
    const total = items.length;
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    };
  }

  async statement(p: Principal, id: string): Promise<InstitutionStatementView> {
    const row = await this.prisma.institution.findFirst({
      where: { AND: [institutionScope(p) as Prisma.InstitutionWhereInput, { id }] },
      include: { region: { select: { name: true } } },
    });
    if (!row) throw new NotFoundError('Institution');
    const [summary] = await this.summarize([row]);
    const instruments = await this.prisma.instrument.findMany({
      where: { AND: [instrumentScope(p) as Prisma.InstrumentWhereInput, { institutionId: id }] },
      include: SUMMARY_INCLUDE,
      orderBy: [{ status: 'asc' }, { maturityDate: 'asc' }],
    });
    await this.audit.record({
      actor: actorOf(p),
      action: 'institution.viewed',
      entityType: 'Institution',
      entityId: id,
    });
    return {
      ...summary!,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      instruments: instruments.map(toSummary),
    };
  }

  /** Global search across institutions and instruments, scoped. */
  async search(p: Principal, q: string) {
    const term = q.trim();
    if (term.length < 2) return { institutions: [], instruments: [] };
    const [institutions, instruments] = await Promise.all([
      this.prisma.institution.findMany({
        where: {
          AND: [
            institutionScope(p) as Prisma.InstitutionWhereInput,
            {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { aicteId: { contains: term, mode: 'insensitive' } },
              ],
            },
          ],
        },
        select: { id: true, name: true, aicteId: true, region: { select: { name: true } } },
        take: 6,
      }),
      this.prisma.instrument.findMany({
        where: {
          AND: [
            instrumentScope(p) as Prisma.InstrumentWhereInput,
            {
              OR: [
                { refNo: { contains: term, mode: 'insensitive' } },
                { fdrNumber: { contains: term, mode: 'insensitive' } },
                { institution: { name: { contains: term, mode: 'insensitive' } } },
                { bank: { name: { contains: term, mode: 'insensitive' } } },
              ],
            },
          ],
        },
        include: SUMMARY_INCLUDE,
        take: 8,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    return { institutions, instruments: instruments.map(toSummary) };
  }
}
