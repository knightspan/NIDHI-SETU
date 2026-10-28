import { Injectable, Logger } from '@nestjs/common';
import { HELD_STATES, type Role, type ValidityStatus } from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { BankService } from '../bank/bank.service.js';
import { needsReattestation } from '../domain/signals.js';
import { TrinetraService } from '../instruments/trinetra.service.js';
import { TaxService } from '../tax/tax.service.js';
import { SYSTEM_ACTOR, type Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { DAY_MS, addDays, toIso } from '../domain/dates.js';
import {
  escalationKey,
  planEscalations,
  type Escalatable,
  type EscalationType,
  type PlannedEscalation,
} from '../domain/escalation.js';
import { planReminders, reminderKey } from '../domain/reminders.js';
import { computeValidity } from '../domain/validity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';

const CHUNK = 5_000;
const LAST_RUN_KEY = 'lifecycle_last_run';

export interface LifecycleSummary {
  trigger: string;
  today: string;
  heldInstruments: number;
  validityChanged: number;
  validityCounts: Record<string, number>;
  remindersCreated: number;
  reminderNotifications: number;
  escalationsCreated: number;
  escalationsResolved: number;
  escalationNotifications: number;
  /** TRINETRA: scheduled re-attestations requested for stale bank signals. */
  reattestationsRequested: number;
  /** TRINETRA: AIS requests issued this run (yearly). */
  aisRequested: number;
  /** Instruments whose trust / risk changed in the nightly rescore. */
  rescored: number;
  /** Signed checkpoint of the audit chain taken at the end of the run. */
  auditAnchor?: { id: number; seq: string; hash: string } | null;
  durationMs: number;
  finishedAt: string;
}

function chunks<T>(list: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const inr = (v: unknown) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

/**
 * The daily lifecycle job (Section 7 · cap 4 & 7): recomputes validity, sends maturity reminders
 * (one per instrument per offset) and escalates items past their SLA up the configured ladder.
 * Everything is set-based so it scales to tens of thousands of instruments.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);
  private running: Promise<LifecycleSummary> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly rules: RulesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly trinetra: TrinetraService,
    private readonly bank: BankService,
    private readonly tax: TaxService,
  ) {}

  /** Runs the job; concurrent callers share the same run. */
  run(trigger: string, actor: Actor = SYSTEM_ACTOR): Promise<LifecycleSummary> {
    this.running ??= this.execute(trigger, actor).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async lastRun(): Promise<LifecycleSummary | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: LAST_RUN_KEY } });
    return (row?.value as LifecycleSummary | undefined) ?? null;
  }

  private async execute(trigger: string, actor: Actor): Promise<LifecycleSummary> {
    const started = Date.now();
    await this.clock.sync(true);
    const today = this.clock.today();
    const now = this.clock.now();
    const rules = await this.rules.current(now);

    // ── 1. Validity ──────────────────────────────────────────────────────────
    const held = await this.prisma.instrument.findMany({
      where: { status: { in: [...HELD_STATES] } },
      select: { id: true, status: true, maturityDate: true, validityStatus: true },
    });
    const changes = new Map<ValidityStatus | 'NULL', string[]>();
    const counts: Record<string, number> = {};
    for (const i of held) {
      const v = computeValidity(i, today, rules['validity.window']);
      counts[v ?? 'NONE'] = (counts[v ?? 'NONE'] ?? 0) + 1;
      if (v !== i.validityStatus) {
        const k = v ?? 'NULL';
        changes.set(k, [...(changes.get(k) ?? []), i.id]);
      }
    }
    let validityChanged = 0;
    for (const [v, ids] of changes) {
      for (const part of chunks(ids)) {
        const r = await this.prisma.instrument.updateMany({
          where: { id: { in: part } },
          data: { validityStatus: v === 'NULL' ? null : v },
        });
        validityChanged += r.count;
      }
    }
    // Instruments no longer held lose their validity status.
    const cleared = await this.prisma.instrument.updateMany({
      where: { status: { notIn: [...HELD_STATES] }, validityStatus: { not: null } },
      data: { validityStatus: null },
    });
    validityChanged += cleared.count;

    // ── 2. Maturity reminders ────────────────────────────────────────────────
    const reminderRule = rules['reminders.maturity'];
    const maxOffset = Math.max(...reminderRule.offsetsDays);
    const candidates = await this.prisma.instrument.findMany({
      where: { status: 'ACTIVE', maturityDate: { gt: today, lte: addDays(today, maxOffset) } },
      select: {
        id: true,
        refNo: true,
        maturityDate: true,
        amount: true,
        institutionId: true,
        bankId: true,
        institution: { select: { name: true, regionId: true } },
      },
    });
    const existing = new Set<string>();
    for (const part of chunks(candidates.map((c) => c.id))) {
      const rows = await this.prisma.reminder.findMany({
        where: { instrumentId: { in: part } },
        select: { instrumentId: true, offsetDays: true },
      });
      rows.forEach((r) => existing.add(reminderKey(r.instrumentId, r.offsetDays)));
    }
    const planned = planReminders(
      candidates.map((c) => ({ id: c.id, maturityDate: c.maturityDate! })),
      today,
      reminderRule.offsetsDays,
      existing,
    );
    let remindersCreated = 0;
    for (const part of chunks(planned)) {
      const r = await this.prisma.reminder.createMany({
        data: part.map((p) => ({
          instrumentId: p.instrumentId,
          offsetDays: p.offsetDays,
          dueDate: p.dueDate,
          sentAt: now,
        })),
        skipDuplicates: true,
      });
      remindersCreated += r.count;
    }
    const recipients = await this.recipientIndex(reminderRule.recipients);
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const reminderMessages = planned
      .filter((x) => x.notify)
      .map((p) => {
        const c = byId.get(p.instrumentId)!;
        const days = Math.round((c.maturityDate!.getTime() - today.getTime()) / DAY_MS);
        return {
          userIds: recipients(c.institutionId, c.institution.regionId, c.bankId),
          msg: {
            kind: 'REMINDER' as const,
            title: `${c.refNo} matures in ${days} day(s)`,
            body: `The security deposit ${c.refNo} (${inr(c.amount)}) of ${c.institution.name} matures on ${toIso(c.maturityDate!)}. Submit a renewal or replacement FDR before maturity (reminder T-${p.offsetDays}).`,
            instrumentId: c.id,
            link: `/instruments/${c.id}`,
            sms: p.offsetDays <= 7,
          },
        };
      });
    const reminderNotifications = await this.notifications.notifyBulk(
      this.prisma,
      reminderMessages,
    );

    // ── 3. TRINETRA ──────────────────────────────────────────────────────────
    const reattestationsRequested = await this.reattestStale(
      now,
      rules['verification.signals'].reattestationDailyCap,
    );
    const ais = await this.tax.requestAis(actor);
    const scored = await this.prisma.instrument.findMany({
      where: { status: { notIn: ['DRAFT', 'REJECTED', 'RENEWED', 'RELEASED', 'FORFEITED'] } },
      select: { id: true },
    });
    const rescored = await this.trinetra.rescoreMany(scored.map((i) => i.id));

    // ── 4. Escalations ───────────────────────────────────────────────────────
    const esc = await this.escalate(
      today,
      now,
      rules['escalation.sla'],
      rules['validity.window'].renewalGraceDays,
    );

    const summary: LifecycleSummary = {
      trigger,
      today: toIso(today),
      heldInstruments: held.length,
      validityChanged,
      validityCounts: counts,
      remindersCreated,
      reminderNotifications,
      escalationsCreated: esc.created,
      escalationsResolved: esc.resolved,
      escalationNotifications: esc.notified,
      reattestationsRequested,
      aisRequested: ais.requested,
      rescored,
      durationMs: Date.now() - started,
      finishedAt: new Date().toISOString(),
    };
    await this.prisma.systemSetting.upsert({
      where: { key: LAST_RUN_KEY },
      create: { key: LAST_RUN_KEY, value: { ...summary } },
      update: { value: { ...summary } },
    });
    await this.audit.record({
      actor,
      action: 'lifecycle.run',
      entityType: 'Job',
      entityId: null,
      data: { ...summary },
    });
    // Daily checkpoint: sign the chain head and send a copy to the auditors (kept off the database).
    const anchor = await this.audit.anchor();
    if (anchor) {
      summary.auditAnchor = { id: anchor.id, seq: anchor.seq.toString(), hash: anchor.hash };
      const auditors = await this.prisma.user.findMany({
        where: { role: 'AUDITOR', active: true },
        select: { id: true },
      });
      await this.notifications.notifyUsers(
        this.prisma,
        auditors.map((u) => u.id),
        {
          kind: 'SYSTEM',
          title: `Audit anchor #${anchor.id}`,
          body: `Audit chain checkpoint #${anchor.id}: event ${anchor.seq}, hash ${anchor.hash}. Keep this message: it lets you prove later that the trail was not rewritten.`,
          link: '/audit',
        },
      );
      await this.prisma.systemSetting.update({
        where: { key: LAST_RUN_KEY },
        data: { value: { ...summary } },
      });
    }
    this.logger.log(
      `lifecycle (${trigger}) ${summary.today}: ${held.length} held, ${validityChanged} validity changes, ` +
        `${remindersCreated} reminders, ${esc.created} escalations in ${summary.durationMs} ms`,
    );
    return summary;
  }

  /**
   * Scheduled re-attestation (TRINETRA bank eye): every ACTIVE deposit whose bank confirmation has
   * gone STALE gets a fresh bank request (up to the daily cap). Uses the demo clock, so moving it
   * forward a year makes confirmations stale.
   */
  private async reattestStale(now: Date, cap: number): Promise<number> {
    const active = await this.prisma.instrument.findMany({
      where: { status: 'ACTIVE', bankId: { not: null } },
      select: { id: true, status: true },
    });
    if (!active.length) return 0;
    const ids = active.map((a) => a.id);
    const [bankSignals, openReqs] = await Promise.all([
      this.prisma.verificationSignal.findMany({
        where: { instrumentId: { in: ids }, eye: 'BANK' },
        orderBy: { checkedAt: 'desc' },
        select: { instrumentId: true, result: true, checkedAt: true, validUntil: true },
      }),
      this.prisma.bankConfirmationRequest.findMany({
        where: { instrumentId: { in: ids }, status: { in: ['PENDING', 'FAILED'] } },
        select: { instrumentId: true },
      }),
    ]);
    const latest = new Map<string, (typeof bankSignals)[number]>();
    for (const s of bankSignals) if (!latest.has(s.instrumentId)) latest.set(s.instrumentId, s);
    const open = new Set(openReqs.map((r) => r.instrumentId));
    const due = active.filter((a) =>
      needsReattestation({
        status: a.status,
        latestBank: latest.get(a.id) ?? null,
        hasOpenBankRequest: open.has(a.id),
        now,
      }),
    );
    const created: string[] = [];
    for (const a of due.slice(0, cap)) {
      const id = await this.prisma.$transaction(async (tx) => {
        const last = latest.get(a.id);
        // Record that the bank eye went stale (once), then ask the bank again.
        if (last?.result === 'PASS') {
          await this.trinetra.record(tx, {
            instrumentId: a.id,
            eye: 'BANK',
            result: 'STALE',
            details: {
              note: 'Bank confirmation older than the configured validity',
              previousCheckedAt: last.checkedAt.toISOString(),
            },
          });
        }
        return this.bank.createReattestation(
          tx,
          a.id,
          'Scheduled re-attestation: bank confirmation is stale',
          null,
        );
      });
      if (id) created.push(id);
    }
    for (const id of created) await this.bank.dispatchIfApi(id);
    return created.length;
  }

  /** Builds a fast lookup of in-scope recipients for many instruments at once. */
  private async recipientIndex(roles: readonly Role[]) {
    const users = await this.prisma.user.findMany({
      where: { active: true, role: { in: [...roles] } },
      select: { id: true, role: true, institutionId: true, regionId: true, bankId: true },
    });
    return (institutionId: string, regionId: string, bankId: string | null): string[] =>
      users
        .filter((u) => {
          if (u.role === 'INSTITUTION_USER') return u.institutionId === institutionId;
          if (u.role === 'RO_OFFICER') return u.regionId === regionId;
          if (u.role === 'BANK_OFFICER') return u.bankId === bankId;
          return true;
        })
        .map((u) => u.id);
  }

  private async escalate(
    today: Date,
    now: Date,
    sla: Parameters<typeof planEscalations>[2],
    graceDays: number,
  ): Promise<{ created: number; resolved: number; notified: number }> {
    const items: Escalatable[] = [];

    const scrutiny = await this.prisma.instrument.findMany({
      where: { status: { in: ['SUBMITTED', 'UNDER_SCRUTINY'] } },
      select: { id: true, refNo: true, statusChangedAt: true },
    });
    scrutiny.forEach((i) =>
      items.push({
        type: 'INSTRUMENT_SCRUTINY',
        entityId: i.id,
        instrumentId: i.id,
        since: i.statusChangedAt,
        label: `Scrutiny of ${i.refNo} pending`,
      }),
    );

    const discrepancies = await this.prisma.discrepancy.findMany({
      where: {
        status: 'OPEN',
        instrument: { status: { notIn: ['REJECTED', 'RELEASED', 'RENEWED'] } },
      },
      select: {
        id: true,
        instrumentId: true,
        createdAt: true,
        ruleCode: true,
        instrument: { select: { refNo: true } },
      },
    });
    discrepancies.forEach((d) =>
      items.push({
        type: 'DISCREPANCY',
        entityId: d.id,
        instrumentId: d.instrumentId,
        since: d.createdAt,
        label: `Discrepancy ${d.ruleCode} on ${d.instrument.refNo} unanswered`,
      }),
    );

    const bankReqs = await this.prisma.bankConfirmationRequest.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      select: {
        id: true,
        instrumentId: true,
        createdAt: true,
        bank: { select: { name: true } },
        instrument: { select: { refNo: true } },
      },
    });
    bankReqs.forEach((b) =>
      items.push({
        type: 'BANK_REQUEST',
        entityId: b.id,
        instrumentId: b.instrumentId,
        since: b.createdAt,
        label: `${b.bank.name} has not confirmed ${b.instrument.refNo}`,
      }),
    );

    const releases = await this.prisma.releaseRequest.findMany({
      where: { status: { in: ['REQUESTED', 'RECOMMENDED', 'APPROVED'] } },
      select: {
        id: true,
        instrumentId: true,
        status: true,
        requestedAt: true,
        recommendedAt: true,
        decidedAt: true,
        instrument: { select: { refNo: true } },
      },
    });
    releases.forEach((r) =>
      items.push({
        type: 'RELEASE',
        entityId: r.id,
        instrumentId: r.instrumentId,
        since:
          r.status === 'REQUESTED'
            ? r.requestedAt
            : r.status === 'RECOMMENDED'
              ? (r.recommendedAt ?? r.requestedAt)
              : (r.decidedAt ?? r.requestedAt),
        label: `Release of ${r.instrument.refNo} awaiting ${r.status === 'REQUESTED' ? 'recommendation' : r.status === 'RECOMMENDED' ? 'decision' : 'execution'}`,
      }),
    );

    const overdue = await this.prisma.instrument.findMany({
      where: { validityStatus: 'OVERDUE_RENEWAL' },
      select: { id: true, refNo: true, maturityDate: true },
    });
    overdue.forEach((i) =>
      items.push({
        type: 'OVERDUE_RENEWAL',
        entityId: i.id,
        instrumentId: i.id,
        since: addDays(i.maturityDate!, graceDays + 1),
        label: `${i.refNo} matured on ${toIso(i.maturityDate!)} and has not been renewed`,
      }),
    );

    const aisOverdue = await this.prisma.aisRequest.findMany({
      where: { fulfilledAt: null },
      select: {
        id: true,
        fy: true,
        requestedAt: true,
        institution: {
          select: {
            name: true,
            instruments: {
              where: { status: { in: [...HELD_STATES] } },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
    aisOverdue.forEach((a) => {
      const instrumentId = a.institution.instruments[0]?.id;
      if (!instrumentId) return;
      items.push({
        type: 'AIS_UPLOAD',
        entityId: a.id,
        instrumentId,
        since: a.requestedAt,
        label: `${a.institution.name} has not uploaded its AIS for FY ${a.fy}`,
      });
    });

    const forfeitures = await this.prisma.forfeitureRequest.findMany({
      where: { status: { in: ['PROPOSED', 'APPROVED'] } },
      select: {
        id: true,
        instrumentId: true,
        status: true,
        proposedAt: true,
        decidedAt: true,
        instrument: { select: { refNo: true } },
      },
    });
    forfeitures.forEach((f) =>
      items.push({
        type: 'FORFEITURE',
        entityId: f.id,
        instrumentId: f.instrumentId,
        since: f.status === 'PROPOSED' ? f.proposedAt : (f.decidedAt ?? f.proposedAt),
        label: `Forfeiture of ${f.instrument.refNo} awaiting ${f.status === 'PROPOSED' ? 'decision' : 'execution'}`,
      }),
    );

    const existingRows = await this.prisma.escalation.findMany({
      where: { entityId: { in: items.map((i) => i.entityId) } },
      select: { entityType: true, entityId: true, level: true },
    });
    const existing = new Set(
      existingRows.map((e) => escalationKey(e.entityType, e.entityId, e.level)),
    );
    const plan = planEscalations(items, today, sla, existing);

    let notified = 0;
    if (plan.length) {
      await this.prisma.escalation.createMany({
        data: plan.map((p) => ({
          entityType: p.type,
          entityId: p.entityId,
          instrumentId: p.instrumentId,
          level: p.level,
          toRole: p.toRole,
          reason: p.reason,
          createdAt: now,
        })),
        skipDuplicates: true,
      });
      // Notify only the highest new level per item.
      const top = new Map<string, PlannedEscalation>();
      for (const p of plan) {
        const k = `${p.type}:${p.entityId}`;
        if (!top.has(k) || top.get(k)!.level < p.level) top.set(k, p);
      }
      for (const p of top.values()) {
        const roles: Role[] = [p.toRole];
        if (p.type === 'OVERDUE_RENEWAL' || p.type === 'DISCREPANCY')
          roles.push('INSTITUTION_USER');
        if (p.type === 'BANK_REQUEST') roles.push('BANK_OFFICER');
        notified += await this.notifications.notifyInstrument(this.prisma, p.instrumentId, roles, {
          kind: 'ESCALATION',
          title: `Escalation level ${p.level}: ${labelOf(p.type)}`,
          body: p.reason,
          sms: p.level >= 2,
        });
      }
    }

    // Resolve escalations whose item is no longer overdue / open.
    const live = new Set(items.map((i) => `${i.type}:${i.entityId}`));
    const open = await this.prisma.escalation.findMany({
      where: { resolvedAt: null },
      select: { id: true, entityType: true, entityId: true },
    });
    const done = open.filter((e) => !live.has(`${e.entityType}:${e.entityId}`)).map((e) => e.id);
    for (const part of chunks(done)) {
      await this.prisma.escalation.updateMany({
        where: { id: { in: part } },
        data: { resolvedAt: now },
      });
    }
    return { created: plan.length, resolved: done.length, notified };
  }
}

function labelOf(t: EscalationType): string {
  return {
    INSTRUMENT_SCRUTINY: 'scrutiny overdue',
    DISCREPANCY: 'discrepancy unanswered',
    BANK_REQUEST: 'bank confirmation overdue',
    RELEASE: 'release decision overdue',
    OVERDUE_RENEWAL: 'renewal overdue',
    AIS_UPLOAD: 'AIS upload overdue',
    FORFEITURE: 'forfeiture decision overdue',
  }[t];
}
