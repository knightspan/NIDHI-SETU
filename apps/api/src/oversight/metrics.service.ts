import { Injectable } from '@nestjs/common';
import { HELD_STATES, METRIC_KEYS, type MetricKey, type MetricView } from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { BANK_CONFIRMABLE_FIELDS } from '../domain/trust.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const META: Record<MetricKey, Pick<MetricView, 'unit' | 'betterWhen'>> = {
  verification_turnaround_days: { unit: 'days', betterWhen: 'lower' },
  renewals_before_maturity_pct: { unit: 'percent', betterWhen: 'higher' },
  release_processing_days: { unit: 'days', betterWhen: 'lower' },
  open_discrepancy_age_days: { unit: 'days', betterWhen: 'lower' },
  fully_bank_confirmed_pct: { unit: 'percent', betterWhen: 'higher' },
};

const round = (n: number | null) =>
  n === null || Number.isNaN(n) ? null : Math.round(n * 10) / 10;

/**
 * Outcome metrics for the PS's "measurable improvements" (Section 7 · item 11). Time-based metrics
 * are computed from the tamper-evident audit events, so they cannot be edited after the fact.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  async all(): Promise<MetricView[]> {
    const baselines = new Map(
      (await this.prisma.metricBaseline.findMany()).map((b) => [b.metricKey, b]),
    );
    const values = await Promise.all([
      this.verificationTurnaround(),
      this.renewalsBeforeMaturity(),
      this.releaseProcessing(),
      this.discrepancyAgeing(),
      this.fullyBankConfirmed(),
    ]);
    return values.map((v) => ({
      ...v,
      ...META[v.key],
      baseline: baselines.get(v.key)?.value ?? null,
      baselineNote: baselines.get(v.key)?.note ?? null,
    }));
  }

  /** Median days from submission to activation (audit: instrument.submit → instrument.activate). */
  private async verificationTurnaround() {
    const [r] = await this.prisma.$queryRaw<{ median: number | null; n: bigint }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY d) AS median, count(*) AS n FROM (
        SELECT EXTRACT(EPOCH FROM (
                 min("occurredAt") FILTER (WHERE action = 'instrument.activate')
               - min("occurredAt") FILTER (WHERE action = 'instrument.submit'))) / 86400.0 AS d
        FROM audit_events
        WHERE "entityType" = 'Instrument' AND action IN ('instrument.submit', 'instrument.activate')
        GROUP BY "entityId") t
      WHERE d IS NOT NULL`;
    return {
      key: 'verification_turnaround_days' as const,
      value: round(r?.median ?? null),
      sampleSize: Number(r?.n ?? 0),
    };
  }

  /** Share of replacements submitted before the old instrument matured. */
  private async renewalsBeforeMaturity() {
    const [r] = await this.prisma.$queryRaw<{ before: bigint; n: bigint }[]>`
      SELECT count(*) FILTER (WHERE s.submitted_at::date <= o."maturityDate") AS before, count(*) AS n
      FROM "Instrument" rep
      JOIN "Instrument" o ON o.id = rep."replacesInstrumentId"
      JOIN (SELECT "entityId", min("occurredAt") AS submitted_at FROM audit_events
            WHERE action = 'instrument.submit' GROUP BY "entityId") s ON s."entityId" = rep.id::text
      WHERE o."maturityDate" IS NOT NULL`;
    const n = Number(r?.n ?? 0);
    return {
      key: 'renewals_before_maturity_pct' as const,
      value: n ? round((Number(r!.before) / n) * 100) : null,
      sampleSize: n,
    };
  }

  /** Mean days from release request to execution (audit: release.requested → release.executed). */
  private async releaseProcessing() {
    const [r] = await this.prisma.$queryRaw<{ avg: number | null; n: bigint }[]>`
      SELECT avg(d) AS avg, count(*) AS n FROM (
        SELECT EXTRACT(EPOCH FROM (
                 min("occurredAt") FILTER (WHERE action = 'release.executed')
               - min("occurredAt") FILTER (WHERE action = 'release.requested'))) / 86400.0 AS d
        FROM audit_events
        WHERE "entityType" = 'ReleaseRequest' AND action IN ('release.requested', 'release.executed')
        GROUP BY "entityId") t
      WHERE d IS NOT NULL`;
    return {
      key: 'release_processing_days' as const,
      value: round(r?.avg ?? null),
      sampleSize: Number(r?.n ?? 0),
    };
  }

  /** Median age of open discrepancies, with ageing buckets. */
  private async discrepancyAgeing() {
    const now = this.clock.now();
    const open = await this.prisma.discrepancy.findMany({
      where: { status: { in: ['OPEN', 'RESPONDED'] } },
      select: { createdAt: true },
    });
    const ages = open
      .map((d) => Math.max(0, (now.getTime() - d.createdAt.getTime()) / 86_400_000))
      .sort((a, b) => a - b);
    const median = ages.length ? ages[Math.floor((ages.length - 1) / 2)]! : null;
    const bucket = (lo: number, hi: number) => ages.filter((a) => a >= lo && a < hi).length;
    return {
      key: 'open_discrepancy_age_days' as const,
      value: round(median),
      sampleSize: ages.length,
      buckets: [
        { label: '0–7', count: bucket(0, 8) },
        { label: '8–15', count: bucket(8, 16) },
        { label: '16–30', count: bucket(16, 31) },
        { label: '>30', count: bucket(31, Infinity) },
      ],
    };
  }

  /** Share of held instruments whose bank-confirmable fields are all BANK_CONFIRMED. */
  private async fullyBankConfirmed() {
    const fields = Prisma.join([...BANK_CONFIRMABLE_FIELDS]);
    const statuses = Prisma.join([...HELD_STATES]);
    const [r] = await this.prisma.$queryRaw<{ full: bigint; n: bigint }[]>`
      SELECT count(*) FILTER (WHERE c = ${BANK_CONFIRMABLE_FIELDS.length}) AS full, count(*) AS n FROM (
        SELECT i.id, count(DISTINCT fa.field) FILTER (WHERE fa.trust = 'BANK_CONFIRMED' AND fa.field IN (${fields})) AS c
        FROM "Instrument" i LEFT JOIN "FieldAssertion" fa ON fa."instrumentId" = i.id
        WHERE i.status::text IN (${statuses})
        GROUP BY i.id) t`;
    const n = Number(r?.n ?? 0);
    return {
      key: 'fully_bank_confirmed_pct' as const,
      value: n ? round((Number(r!.full) / n) * 100) : null,
      sampleSize: n,
    };
  }

  async setBaseline(key: string, value: number, note: string | undefined, actor: Actor) {
    if (!(METRIC_KEYS as readonly string[]).includes(key)) throw new Error('unknown metric');
    const row = await this.prisma.metricBaseline.upsert({
      where: { metricKey: key },
      create: { metricKey: key, value, note: note ?? null, updatedById: actor.id },
      update: { value, note: note ?? null, updatedById: actor.id },
    });
    await this.audit.record({
      actor,
      action: 'metrics.baseline_set',
      entityType: 'MetricBaseline',
      entityId: key,
      data: { value, note },
    });
    return row;
  }
}
