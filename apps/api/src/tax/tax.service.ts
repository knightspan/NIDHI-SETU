import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  HELD_STATES,
  TAX_TRAIL_CODE,
  type AisRequestView,
  type AisStatementView,
  type Compounding,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { SYSTEM_ACTOR, actorOf, type Actor } from '../common/actor.js';
import { BankService } from '../bank/bank.service.js';
import { ClockService } from '../clock/clock.service.js';
import { AisParseError, interestByBank, parseAis } from '../domain/ais-parser.js';
import { DAY_MS, toIso } from '../domain/dates.js';
import { ForbiddenError, InvalidInputError, NotFoundError } from '../domain/errors.js';
import type { Principal } from '../domain/scope.js';
import {
  evaluateHeartbeat,
  expectedInterestForFy,
  fyBounds,
  fyDueForAis,
} from '../domain/tax-heartbeat.js';
import type { UploadedFile } from '../documents/documents.service.js';
import { TrinetraService } from '../instruments/trinetra.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';

const MAX_AIS_BYTES = 2 * 1024 * 1024;

/** AAATS1234F → AAATS****F (only the shape is useful in the record). */
export function maskPan(pan: string | null): string | null {
  if (!pan) return null;
  const p = pan.trim().toUpperCase();
  return p.length === 10 ? `${p.slice(0, 5)}****${p.slice(9)}` : '****';
}

/**
 * TRINETRA tax eye ("FDR Heartbeat"): the institution uploads its AIS each financial year; bank-
 * reported interest from deposits is compared, bank-wise, with what its live FDRs should have
 * earned. AIS is corroboration only: a FAIL never rejects anything, it raises a HIGH discrepancy,
 * asks the bank to re-attest and locks release and renewal until it does.
 */
@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trinetra: TrinetraService,
    private readonly bank: BankService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
    private readonly clock: ClockService,
  ) {}

  /** Institution uploads an AIS JSON file. Only per-bank totals are kept, not the file. */
  async upload(p: Principal, file: UploadedFile | undefined) {
    if (p.role !== 'INSTITUTION_USER' || !p.institutionId)
      throw new ForbiddenError('Only institutions upload their AIS');
    if (!file) throw new InvalidInputError('Attach the AIS JSON file in the "file" field');
    if (file.size > MAX_AIS_BYTES) throw new InvalidInputError('The AIS file is larger than 2 MB');
    let json: unknown;
    try {
      json = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new InvalidInputError(
        'The file is not valid JSON (download the AIS as JSON from the e-filing portal)',
      );
    }
    let parsed;
    try {
      parsed = parseAis(json);
    } catch (e) {
      if (e instanceof AisParseError) throw new InvalidInputError(e.message);
      throw e;
    }
    const banks = await this.prisma.bank.findMany({
      select: { code: true, name: true, aliases: true },
    });
    const { byBank, unmatched } = interestByBank(parsed.interestFromDeposits, banks);
    const now = this.clock.now();
    const actor = actorOf(p);
    const institutionId = p.institutionId;
    const stmt = await this.prisma.$transaction(async (tx) => {
      const s = await tx.aisStatement.create({
        data: {
          institutionId,
          fy: parsed.fy,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          parser: parsed.parser,
          pan: maskPan(parsed.pan),
          interestByBank: byBank,
          unmatched: unmatched.map((u) => ({ ...u })),
          uploadedById: p.id,
          createdAt: now,
        },
      });
      await tx.aisRequest.updateMany({
        where: { institutionId, fy: parsed.fy, fulfilledAt: null },
        data: { fulfilledAt: now },
      });
      await this.audit.record(
        {
          actor,
          action: 'tax.ais_uploaded',
          entityType: 'AisStatement',
          entityId: s.id,
          data: {
            fy: parsed.fy,
            parser: parsed.parser,
            banks: Object.keys(byBank),
            unmatched: unmatched.length,
          },
        },
        tx,
      );
      return s;
    });
    const evaluation = await this.evaluate(institutionId, parsed.fy, actor);
    return { statement: toStatementView(stmt), evaluation };
  }

  /** Compares the latest AIS for (institution, FY) with the expected interest of its live FDRs. */
  async evaluate(institutionId: string, fy: string, actor: Actor = SYSTEM_ACTOR) {
    const stmt = await this.prisma.aisStatement.findFirst({
      where: { institutionId, fy },
      orderBy: { createdAt: 'desc' },
    });
    if (!stmt) return { fy, evaluated: 0, failed: 0 };
    const now = this.clock.now();
    const rule = (await this.rules.current(now))['verification.signals'];
    const { start, endExclusive } = fyBounds(fy);
    const instruments = await this.prisma.instrument.findMany({
      where: {
        institutionId,
        status: { in: [...HELD_STATES] },
        bankCode: { not: null },
        issueDate: { lt: new Date(`${endExclusive}T00:00:00Z`) },
        maturityDate: { gt: new Date(`${start}T00:00:00Z`) },
      },
      include: { bank: { select: { compounding: true } } },
    });
    const expectedOf = new Map<string, number | null>();
    const expectedByBank: Record<string, number> = {};
    for (const i of instruments) {
      const compounding: Compounding = i.bank?.compounding ?? rule.defaultCompounding;
      const e =
        i.interestRate && i.amount && i.issueDate && i.maturityDate
          ? expectedInterestForFy({
              principal: Number(i.amount),
              ratePct: Number(i.interestRate),
              issueDate: toIso(i.issueDate),
              maturityDate: toIso(i.maturityDate),
              compounding,
              fy,
            })
          : null;
      expectedOf.set(i.id, e);
      if (e !== null) expectedByBank[i.bankCode!] = (expectedByBank[i.bankCode!] ?? 0) + e;
    }
    const reported = stmt.interestByBank as Record<string, number>;
    const byBank = evaluateHeartbeat(expectedByBank, reported, rule.taxTolerancePct);

    let failed = 0;
    const reattest: string[] = [];
    for (const i of instruments) {
      const e = expectedOf.get(i.id) ?? null;
      const bank = byBank[i.bankCode!];
      const result = e === null || !bank ? 'NOT_AVAILABLE' : bank.result;
      const details = {
        fy,
        bankCode: i.bankCode,
        expected: e === null ? null : Math.round(e * 100) / 100,
        bankExpected: bank?.expected ?? null,
        bankReported: bank?.reported ?? reported[i.bankCode!] ?? 0,
        tolerancePct: rule.taxTolerancePct,
        statementId: stmt.id,
        note:
          result === 'NOT_AVAILABLE'
            ? 'Interest rate or amount unknown; cannot compute expected interest'
            : result === 'PASS'
              ? 'The bank reported at least the interest this deposit should have earned'
              : 'Trail broken: the bank reported materially less interest than expected (possible premature closure)',
      };
      const prev = await this.prisma.verificationSignal.findFirst({
        where: { instrumentId: i.id, eye: 'TAX', fy },
        orderBy: { checkedAt: 'desc' },
      });
      if (
        prev &&
        prev.result === result &&
        JSON.stringify(prev.details) === JSON.stringify(details)
      )
        continue;
      await this.prisma.$transaction(async (tx) => {
        await this.trinetra.record(
          tx,
          { instrumentId: i.id, eye: 'TAX', result, fy, details },
          actor,
        );
        if (result !== 'FAIL' || prev?.result === 'FAIL') return;
        failed++;
        const sla = (await this.rules.current(now, tx))['escalation.sla'];
        await tx.discrepancy.create({
          data: {
            instrumentId: i.id,
            ruleCode: TAX_TRAIL_CODE,
            key: `${TAX_TRAIL_CODE}:${i.id}:${fy}`,
            severity: 'HIGH',
            description: `FDR heartbeat FY ${fy}: ${i.bankCode} reported ₹${details.bankReported.toLocaleString('en-IN')} interest against ₹${(details.bankExpected ?? 0).toLocaleString('en-IN')} expected. The deposit may have been closed early. Release and renewal are locked until the bank re-attests.`,
            autoRaised: true,
            dueAt: new Date(now.getTime() + sla.discrepancyResponseDays * DAY_MS),
            createdAt: now,
          },
        });
        await this.trinetra.rescore(tx, i.id);
        const req = await this.bank.createReattestation(
          tx,
          i.id,
          `Tax heartbeat FY ${fy} failed`,
          null,
        );
        if (req) reattest.push(req);
        await this.notifications.notifyInstrument(tx, i.id, ['RO_OFFICER', 'INSTITUTION_USER'], {
          kind: 'DISCREPANCY',
          title: `FDR heartbeat failed for ${i.refNo} (FY ${fy})`,
          body: details.note,
          sms: true,
        });
      });
    }
    for (const id of reattest) await this.bank.dispatchIfApi(id);
    return { fy, evaluated: instruments.length, failed };
  }

  /**
   * Yearly (and demo-clock-aware on demand): requests the last completed FY's AIS from every
   * institution holding a deposit that was live in it. Unfulfilled requests escalate after the SLA.
   */
  async requestAis(actor: Actor = SYSTEM_ACTOR): Promise<{ fy: string; requested: number }> {
    const now = this.clock.now();
    const rules = await this.rules.current(now);
    const fy = fyDueForAis(this.clock.todayIso(), rules['verification.signals'].aisRequestMonthDay);
    const { start, endExclusive } = fyBounds(fy);
    const held = await this.prisma.instrument.findMany({
      where: {
        status: { in: [...HELD_STATES] },
        issueDate: { lt: new Date(`${endExclusive}T00:00:00Z`) },
        maturityDate: { gt: new Date(`${start}T00:00:00Z`) },
      },
      select: { id: true, institutionId: true },
    });
    const byInstitution = new Map<string, string[]>();
    for (const h of held)
      byInstitution.set(h.institutionId, [...(byInstitution.get(h.institutionId) ?? []), h.id]);
    const existing = new Set(
      (
        await this.prisma.aisRequest.findMany({ where: { fy }, select: { institutionId: true } })
      ).map((r) => r.institutionId),
    );
    let requested = 0;
    for (const [institutionId, instrumentIds] of byInstitution) {
      if (existing.has(institutionId)) continue;
      const stmt = await this.prisma.aisStatement.findFirst({ where: { institutionId, fy } });
      await this.prisma.$transaction(async (tx) => {
        await tx.aisRequest.create({
          data: {
            institutionId,
            fy,
            requestedAt: now,
            dueAt: new Date(now.getTime() + rules['escalation.sla'].aisUploadDays * DAY_MS),
            fulfilledAt: stmt ? now : null,
          },
        });
        if (stmt) return;
        // Nothing to compare yet: the tax eye reads NOT_AVAILABLE for this year.
        for (const instrumentId of instrumentIds) {
          const has = await tx.verificationSignal.count({
            where: { instrumentId, eye: 'TAX', fy },
          });
          if (!has)
            await this.trinetra.record(
              tx,
              {
                instrumentId,
                eye: 'TAX',
                result: 'NOT_AVAILABLE',
                fy,
                details: { fy, note: 'AIS not uploaded yet' },
              },
              actor,
            );
        }
        await this.notifications.notifyInstrument(tx, instrumentIds[0]!, ['INSTITUTION_USER'], {
          kind: 'REMINDER',
          title: `Upload your AIS for FY ${fy}`,
          body: `Download the Annual Information Statement (JSON) for FY ${fy} from the Income Tax e-filing portal and upload it under Tax heartbeat. It corroborates that your deposits are still earning interest.`,
          link: '/tax',
        });
      });
      if (stmt) await this.evaluate(institutionId, fy, actor);
      requested++;
    }
    if (requested) this.logger.log(`AIS requested for FY ${fy} from ${requested} institution(s)`);
    return { fy, requested };
  }

  /** The institution's own AIS requests and uploads (officers: any institution in scope). */
  async overview(
    p: Principal,
    institutionId?: string,
  ): Promise<{ requests: AisRequestView[]; statements: AisStatementView[] }> {
    const id = p.role === 'INSTITUTION_USER' ? p.institutionId : institutionId;
    if (!id) throw new InvalidInputError('institutionId is required');
    if (p.role === 'RO_OFFICER') {
      const inst = await this.prisma.institution.findFirst({
        where: { id, regionId: p.regionId ?? '' },
      });
      if (!inst) throw new NotFoundError('Institution');
    }
    const [requests, statements] = await Promise.all([
      this.prisma.aisRequest.findMany({ where: { institutionId: id }, orderBy: { fy: 'desc' } }),
      this.prisma.aisStatement.findMany({
        where: { institutionId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      requests: requests.map((r) => ({
        id: r.id,
        fy: r.fy,
        requestedAt: r.requestedAt.toISOString(),
        dueAt: r.dueAt.toISOString(),
        fulfilledAt: r.fulfilledAt?.toISOString() ?? null,
      })),
      statements: statements.map(toStatementView),
    };
  }
}

function toStatementView(s: {
  id: string;
  fy: string;
  parser: string;
  interestByBank: unknown;
  unmatched: unknown;
  createdAt: Date;
}): AisStatementView {
  return {
    id: s.id,
    fy: s.fy,
    parser: s.parser,
    interestByBank: s.interestByBank as Record<string, number>,
    unmatched: s.unmatched as { source: string; amount: number }[],
    uploadedAt: s.createdAt.toISOString(),
  };
}
