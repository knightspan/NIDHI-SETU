import { Injectable } from '@nestjs/common';
import {
  DOCUMENT_CHECK_CODE,
  SIGNAL_EYES,
  type Compounding,
  type HeartbeatCell,
  type InstrumentVerificationView,
  type SignalEye,
  type SignalResult,
  type SignalView,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { SYSTEM_ACTOR, type Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { DAY_MS, toIso } from '../domain/dates.js';
import { checkDuplicates, checkIfsc, combineDocumentEye } from '../domain/document-eye.js';
import { checkMaturityMath } from '../domain/maturity-math.js';
import {
  computeRisk,
  computeTrustScore,
  effectiveResult,
  evaluateReverificationGate,
  isTaxLocked,
  trustTierOf,
  type SignalLike,
} from '../domain/signals.js';
import { fyOf, previousFy } from '../domain/tax-heartbeat.js';
import { computeFieldState, computeFieldStates, trustScore } from '../domain/trust.js';
import { Prisma, type VerificationSignal } from '../generated/prisma/client.js';
import { PrismaService, type Db } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';

export interface SignalInput {
  instrumentId: string;
  eye: SignalEye;
  result: SignalResult;
  fy?: string | null;
  details: Record<string, unknown>;
  evidenceDocumentId?: string | null;
  validUntil?: Date | null;
}

type Latest = Record<SignalEye, VerificationSignal | null>;

const HIGH_OPEN = {
  severity: 'HIGH',
  status: { in: ['OPEN', 'RESPONDED'] },
} satisfies Prisma.DiscrepancyWhereInput;
const CHUNK = 500;

/**
 * TRINETRA (addendum): the bank, tax and document "eyes", the trust score built from them, the risk
 * level and the re-verification gate. Every check is stored as a VerificationSignal row.
 */
@Injectable()
export class TrinetraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: RulesService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  // ─── Signals ──────────────────────────────────────────────────────────────

  /** Latest signal per eye (tax: latest financial year first). */
  async latest(db: Db, instrumentId: string): Promise<Latest> {
    const rows = await db.verificationSignal.findMany({
      where: { instrumentId },
      orderBy: { checkedAt: 'desc' },
    });
    return pickLatest(rows);
  }

  async record(
    tx: Prisma.TransactionClient,
    s: SignalInput,
    actor: Actor = SYSTEM_ACTOR,
    opts: { rescore?: boolean } = {},
  ) {
    const row = await tx.verificationSignal.create({
      data: {
        instrumentId: s.instrumentId,
        eye: s.eye,
        result: s.result,
        fy: s.fy ?? null,
        details: s.details as Prisma.InputJsonValue,
        evidenceDocumentId: s.evidenceDocumentId ?? null,
        checkedAt: this.clock.now(),
        validUntil: s.validUntil ?? null,
      },
    });
    await this.audit.record(
      {
        actor,
        action: 'signal.recorded',
        entityType: 'Instrument',
        entityId: s.instrumentId,
        data: { eye: s.eye, result: s.result, fy: s.fy ?? undefined },
      },
      tx,
    );
    if (opts.rescore !== false) await this.rescore(tx, s.instrumentId);
    return row;
  }

  /** Bank eye after a bank answer: PASS valid for N months, or FAIL. */
  async recordBank(
    tx: Prisma.TransactionClient,
    instrumentId: string,
    confirmed: boolean,
    details: Record<string, unknown>,
    evidenceDocumentId: string | null,
    actor: Actor,
  ) {
    const rule = (await this.rules.current(this.clock.now(), tx))['verification.signals'];
    const validUntil = new Date(this.clock.now());
    validUntil.setUTCMonth(validUntil.getUTCMonth() + rule.bankStaleMonths);
    return this.record(
      tx,
      {
        instrumentId,
        eye: 'BANK',
        result: confirmed ? 'PASS' : 'FAIL',
        details,
        evidenceDocumentId,
        validUntil: confirmed ? validUntil : null,
      },
      actor,
    );
  }

  /**
   * Document eye: maturity math, IFSC master and duplicates. Does not rescore: call rescore after. A new signal is written only when the
   * outcome changes. Maturity-math and IFSC failures also open a HIGH discrepancy (duplicates have
   * their own rules).
   */
  async evaluateDocument(
    tx: Prisma.TransactionClient,
    instrumentId: string,
    actor: Actor = SYSTEM_ACTOR,
  ) {
    const head = await tx.instrument.findUniqueOrThrow({
      where: { id: instrumentId },
      select: { status: true },
    });
    if (head.status === 'DRAFT') return null;
    const inst = await tx.instrument.findUniqueOrThrow({
      where: { id: instrumentId },
      include: {
        bank: { select: { compounding: true } },
        institution: { select: { id: true } },
        documents: { where: { type: 'FDR_SCAN' }, orderBy: { version: 'desc' }, take: 1 },
        assertions: true,
        replacedBy: { select: { id: true } },
      },
    });
    if (inst.status === 'DRAFT') return null;
    const rule = (await this.rules.current(this.clock.now(), tx))['verification.signals'];
    const amount = computeFieldState('amount', inst.assertions);
    const rate = computeFieldState('interestRate', inst.assertions);
    const mv = computeFieldState('maturityValue', inst.assertions);
    // What the scan shows wins over what was typed: that is where alterations hide.
    const principal = Number(
      amount.latestByTrust.OCR_EXTRACTED?.value ?? amount.effectiveValue ?? NaN,
    );
    const printed = Number(mv.latestByTrust.OCR_EXTRACTED?.value ?? mv.effectiveValue ?? NaN);
    const compounding: Compounding = inst.bank?.compounding ?? rule.defaultCompounding;
    const maturityMath = checkMaturityMath({
      principal: Number.isFinite(principal) ? principal : null,
      ratePct: rate.effectiveValue ? Number(rate.effectiveValue) : null,
      issueDate: inst.issueDate ? toIso(inst.issueDate) : null,
      maturityDate: inst.maturityDate ? toIso(inst.maturityDate) : null,
      compounding,
      printed: Number.isFinite(printed) ? printed : null,
      tolerancePct: rule.maturityTolerancePct,
    });
    const [master, masterHasBank] = inst.ifsc
      ? await Promise.all([
          tx.ifscBranch.findUnique({ where: { ifsc: inst.ifsc } }),
          inst.bankCode ? tx.ifscBranch.count({ where: { bankCode: inst.bankCode } }) : 0,
        ])
      : [null, 0];
    const ifsc = checkIfsc({
      ifsc: inst.ifsc,
      bankCode: inst.bankCode,
      branch: inst.branch,
      master,
      masterHasBank: masterHasBank > 0,
    });

    const exclude = [inst.id, inst.replacesInstrumentId, inst.replacedBy?.id].filter(
      (x): x is string => !!x,
    );
    const scan = inst.documents[0];
    const [sameFdr, sameDoc] = await Promise.all([
      inst.fdrKey
        ? tx.instrument.findMany({
            where: { fdrKey: inst.fdrKey, id: { notIn: exclude }, status: { not: 'DRAFT' } },
            select: { refNo: true, institution: { select: { name: true } } },
          })
        : [],
      scan
        ? tx.document.findMany({
            where: {
              sha256: scan.sha256,
              instrumentId: { notIn: exclude },
              NOT: { instrumentId: null },
            },
            select: {
              instrument: { select: { refNo: true, institution: { select: { name: true } } } },
            },
          })
        : [],
    ]);
    const duplicate = checkDuplicates({
      hasFdrKey: !!inst.fdrKey,
      hasScan: !!scan,
      sameFdr: sameFdr.map((d) => ({ refNo: d.refNo, institutionName: d.institution.name })),
      sameDocument: sameDoc.map((d) => ({
        refNo: d.instrument!.refNo,
        institutionName: d.instrument!.institution.name,
      })),
    });
    const eye = combineDocumentEye(maturityMath, ifsc, duplicate);
    const details = { compounding, maturityMath, ifsc, duplicate } as Record<string, unknown>;

    const previous = await tx.verificationSignal.findFirst({
      where: { instrumentId, eye: 'DOCUMENT' },
      orderBy: { checkedAt: 'desc' },
    });
    const changed =
      !previous ||
      previous.result !== eye.result ||
      JSON.stringify(previous.details) !== JSON.stringify(details);
    if (changed) {
      await this.record(
        tx,
        {
          instrumentId,
          eye: 'DOCUMENT',
          result: eye.result,
          details,
          evidenceDocumentId: scan?.id ?? null,
        },
        actor,
        { rescore: false },
      );
    }

    // Keep one open DOCUMENT_CHECK_FAILED discrepancy while maturity math or IFSC fail.
    const problems = [maturityMath, ifsc].filter((c) => c.result === 'FAIL').map((c) => c.note);
    const open = await tx.discrepancy.findFirst({
      where: { instrumentId, ruleCode: DOCUMENT_CHECK_CODE, status: { in: ['OPEN', 'RESPONDED'] } },
    });
    const now = this.clock.now();
    if (problems.length && !open) {
      const sla = (await this.rules.current(now, tx))['escalation.sla'];
      await tx.discrepancy.create({
        data: {
          instrumentId,
          ruleCode: DOCUMENT_CHECK_CODE,
          key: `${DOCUMENT_CHECK_CODE}:${instrumentId}`,
          field: maturityMath.result === 'FAIL' ? 'amount' : 'ifsc',
          severity: 'HIGH',
          description: `Document check failed: ${problems.join(' ')}`,
          autoRaised: true,
          dueAt: new Date(now.getTime() + sla.discrepancyResponseDays * DAY_MS),
          createdAt: now,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'discrepancy.auto_raised',
          entityType: 'Instrument',
          entityId: instrumentId,
          data: { ruleCode: DOCUMENT_CHECK_CODE },
        },
        tx,
      );
    } else if (!problems.length && open) {
      await tx.discrepancy.update({
        where: { id: open.id },
        data: { status: 'RESOLVED', resolvedAt: now, resolvedById: null },
      });
    }
    // The caller (InstrumentsService.afterChange) rescores once afterwards.
    return eye;
  }

  // ─── Scores ───────────────────────────────────────────────────────────────

  /** Recomputes trust score, trust tier and risk for one instrument. */
  async rescore(tx: Prisma.TransactionClient, instrumentId: string): Promise<void> {
    const inst = await tx.instrument.findUniqueOrThrow({
      where: { id: instrumentId },
      select: { id: true, maturityDate: true },
    });
    const [assertions, signals, openHigh] = await Promise.all([
      tx.fieldAssertion.findMany({ where: { instrumentId } }),
      tx.verificationSignal.findMany({ where: { instrumentId }, orderBy: { checkedAt: 'desc' } }),
      tx.discrepancy.count({ where: { instrumentId, ...HIGH_OPEN } }),
    ]);
    const score = await this.score(
      assertions,
      pickLatest(signals),
      openHigh,
      inst.maturityDate,
      tx,
    );
    await tx.instrument.update({ where: { id: instrumentId }, data: score });
  }

  private async score(
    assertions: Parameters<typeof computeFieldStates>[0],
    latest: Latest,
    openHigh: number,
    maturityDate: Date | null,
    db: Db,
  ) {
    const now = this.clock.now();
    const rules = await this.rules.current(now, db);
    const states = computeFieldStates(assertions);
    const trust = computeTrustScore(trustScore(states), latest, rules['trust.weights'], now);
    const failed = SIGNAL_EYES.filter((e) => effectiveResult(latest[e], now) === 'FAIL').length;
    const days = maturityDate
      ? Math.floor((maturityDate.getTime() - this.clock.today().getTime()) / DAY_MS)
      : null;
    const risk = computeRisk(
      {
        trustScore: trust,
        openHighDiscrepancies: openHigh,
        failedSignals: failed,
        daysToMaturity: days,
      },
      rules['risk.weights'],
    );
    return {
      trustScore: trust,
      trustTier: trustTierOf(states),
      riskScore: risk.score,
      riskLevel: risk.level,
    };
  }

  /** Daily: rescore many instruments in bulk (signal age and days-to-maturity move every day). */
  async rescoreMany(ids: readonly string[]): Promise<number> {
    let changed = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const [insts, assertions, signals, high] = await Promise.all([
        this.prisma.instrument.findMany({
          where: { id: { in: chunk } },
          select: {
            id: true,
            maturityDate: true,
            trustScore: true,
            riskScore: true,
            riskLevel: true,
            trustTier: true,
          },
        }),
        this.prisma.fieldAssertion.findMany({ where: { instrumentId: { in: chunk } } }),
        this.prisma.verificationSignal.findMany({
          where: { instrumentId: { in: chunk } },
          orderBy: { checkedAt: 'desc' },
        }),
        this.prisma.discrepancy.groupBy({
          by: ['instrumentId'],
          where: { instrumentId: { in: chunk }, ...HIGH_OPEN },
          _count: true,
        }),
      ]);
      const group = <T extends { instrumentId: string }>(rows: T[]) => {
        const m = new Map<string, T[]>();
        for (const r of rows) m.set(r.instrumentId, [...(m.get(r.instrumentId) ?? []), r]);
        return m;
      };
      const byA = group(assertions);
      const byS = group(signals);
      const highBy = new Map(high.map((h) => [h.instrumentId, h._count]));
      const updates: Prisma.Sql[] = [];
      for (const inst of insts) {
        const s = await this.score(
          byA.get(inst.id) ?? [],
          pickLatest(byS.get(inst.id) ?? []),
          highBy.get(inst.id) ?? 0,
          inst.maturityDate,
          this.prisma,
        );
        if (
          s.trustScore === inst.trustScore &&
          s.riskScore === inst.riskScore &&
          s.riskLevel === inst.riskLevel &&
          s.trustTier === inst.trustTier
        )
          continue;
        updates.push(
          Prisma.sql`(${inst.id}::uuid, ${s.trustScore}::int, ${s.riskScore}::float8, ${s.riskLevel}, ${s.trustTier})`,
        );
      }
      if (updates.length) {
        changed += updates.length;
        await this.prisma.$executeRaw`
          UPDATE "Instrument" AS i
          SET "trustScore" = v.t, "riskScore" = v.rs, "riskLevel" = v.rl::"RiskLevel", "trustTier" = v.tt::"TrustTier"
          FROM (VALUES ${Prisma.join(updates)}) AS v(id, t, rs, rl, tt)
          WHERE i."id" = v.id`;
      }
    }
    return changed;
  }

  // ─── Gate and view ────────────────────────────────────────────────────────

  private async gateInputs(db: Db, instrumentId: string) {
    const now = this.clock.now();
    const [bankPass, openHigh, tax, taxFail, rule] = await Promise.all([
      db.verificationSignal.findFirst({
        where: { instrumentId, eye: 'BANK', result: 'PASS' },
        orderBy: { checkedAt: 'desc' },
      }),
      db.discrepancy.count({ where: { instrumentId, ...HIGH_OPEN } }),
      db.verificationSignal.findFirst({
        where: { instrumentId, eye: 'TAX', fy: { not: null } },
        orderBy: [{ fy: 'desc' }, { checkedAt: 'desc' }],
      }),
      db.verificationSignal.findFirst({
        where: { instrumentId, eye: 'TAX', result: 'FAIL' },
        orderBy: { checkedAt: 'desc' },
      }),
      this.rules.current(now, db),
    ]);
    return { now, bankPass, openHigh, tax, taxFail, rule: rule['verification.signals'] };
  }

  /** Re-verification gate (release / forfeiture approval). */
  async gate(db: Db, instrumentId: string) {
    const g = await this.gateInputs(db, instrumentId);
    return evaluateReverificationGate({
      latestBankPassAt: g.bankPass?.checkedAt ?? null,
      openHighDiscrepancies: g.openHigh,
      latestTaxResult: g.tax?.result ?? null,
      now: g.now,
      maxBankPassAgeDays: g.rule.gateBankPassMaxAgeDays,
    });
  }

  async taxLocked(db: Db, instrumentId: string): Promise<boolean> {
    const g = await this.gateInputs(db, instrumentId);
    return isTaxLocked(g.taxFail?.checkedAt ?? null, g.bankPass?.checkedAt ?? null);
  }

  async view(instrumentId: string): Promise<InstrumentVerificationView> {
    const now = this.clock.now();
    const inst = await this.prisma.instrument.findUniqueOrThrow({
      where: { id: instrumentId },
      select: {
        riskLevel: true,
        riskScore: true,
        trustTier: true,
        interestRate: true,
        maturityValue: true,
        issueDate: true,
        maturityDate: true,
        bank: { select: { compounding: true } },
      },
    });
    const [signals, rules, gate, taxLocked] = await Promise.all([
      this.prisma.verificationSignal.findMany({
        where: { instrumentId },
        orderBy: { checkedAt: 'desc' },
      }),
      this.rules.current(now),
      this.gate(this.prisma, instrumentId),
      this.taxLocked(this.prisma, instrumentId),
    ]);
    const latest = pickLatest(signals);
    const eyes = SIGNAL_EYES.map((eye) => ({
      eye,
      result: effectiveResult(latest[eye], now),
      latest: latest[eye] ? toSignalView(latest[eye]) : null,
    }));
    return {
      eyes,
      heartbeat: heartbeatCells(signals, inst.issueDate, inst.maturityDate, this.clock.todayIso()),
      riskLevel: inst.riskLevel,
      riskScore: inst.riskScore,
      trustTier: inst.trustTier,
      taxLocked,
      terms: {
        interestRate: inst.interestRate?.toFixed(2) ?? null,
        maturityValue: inst.maturityValue?.toFixed(2) ?? null,
        compounding: inst.bank?.compounding ?? rules['verification.signals'].defaultCompounding,
      },
      gate,
    };
  }

  /** Signals for the instrument page's history. */
  async history(instrumentId: string): Promise<SignalView[]> {
    const rows = await this.prisma.verificationSignal.findMany({
      where: { instrumentId },
      orderBy: { checkedAt: 'desc' },
      take: 50,
    });
    return rows.map(toSignalView);
  }
}

function pickLatest(rows: readonly VerificationSignal[]): Latest {
  const out: Latest = { BANK: null, TAX: null, DOCUMENT: null };
  for (const r of rows) {
    const cur = out[r.eye];
    if (r.eye === 'TAX') {
      // Latest financial year first, then the latest check within it.
      if (
        !cur ||
        (r.fy ?? '') > (cur.fy ?? '') ||
        ((r.fy ?? '') === (cur.fy ?? '') && r.checkedAt > cur.checkedAt)
      )
        out.TAX = r;
    } else if (!cur || r.checkedAt > cur.checkedAt) {
      out[r.eye] = r;
    }
  }
  return out;
}

export function toSignalView(r: VerificationSignal): SignalView {
  return {
    id: r.id,
    eye: r.eye,
    result: r.result,
    fy: r.fy,
    details: (r.details ?? {}) as Record<string, unknown>,
    evidenceDocumentId: r.evidenceDocumentId,
    checkedAt: r.checkedAt.toISOString(),
    validUntil: r.validUntil?.toISOString() ?? null,
  };
}

/** One cell per financial year the deposit was alive (up to the last completed year). */
function heartbeatCells(
  signals: readonly VerificationSignal[],
  issueDate: Date | null,
  maturityDate: Date | null,
  todayIso: string,
): HeartbeatCell[] {
  if (!issueDate) return [];
  const last = previousFy(fyOf(todayIso));
  const end = maturityDate && toIso(maturityDate) < todayIso ? fyOf(toIso(maturityDate)) : last;
  const cells: HeartbeatCell[] = [];
  for (let fy = fyOf(toIso(issueDate)); fy <= (end < last ? end : last); fy = nextFy(fy)) {
    const s = signals.find((x) => x.eye === 'TAX' && x.fy === fy);
    const d = (s?.details ?? {}) as { bankExpected?: number; bankReported?: number };
    cells.push({
      fy,
      result: s?.result ?? 'NOT_AVAILABLE',
      expected: d.bankExpected ?? null,
      reported: d.bankReported ?? null,
    });
    if (cells.length > 20) break;
  }
  return cells;
}

function nextFy(fy: string): string {
  const start = Number(fy.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export type { SignalLike };
