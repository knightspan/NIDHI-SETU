import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BANK_DENIAL_CODE,
  TAX_TRAIL_CODE,
  type BankRequestListQuery,
  type BankRequestView,
  type BankResponse,
  type BankSnapshot,
  type Paged,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { SYSTEM_ACTOR, actorOf, type Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { evaluateBankResponse } from '../domain/bank-response.js';
import { DAY_MS, toIso } from '../domain/dates.js';
import { ConflictError, InvalidInputError, NotFoundError } from '../domain/errors.js';
import { bankRequestScope, type Principal } from '../domain/scope.js';
import { DiscrepancyEngine } from '../discrepancies/discrepancy-engine.service.js';
import { DocumentsService, type UploadedFile } from '../documents/documents.service.js';
import type { Bank, BankConfirmationRequest, Prisma } from '../generated/prisma/client.js';
import { AssertionsService } from '../instruments/assertions.service.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { TransitionsService } from '../instruments/transitions.service.js';
import { TrinetraService } from '../instruments/trinetra.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';
import {
  BankApiError,
  BankDeskAdapter,
  MockBankApiAdapter,
  type BankVerificationAdapter,
} from './bank-adapters.js';
import { REQUEST_INCLUDE, toBankRequestViews, type RequestRow } from './bank-views.js';

@Injectable()
export class BankService {
  private readonly logger = new Logger(BankService.name);
  private readonly desk = new BankDeskAdapter();
  private readonly mockApi: MockBankApiAdapter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly instruments: InstrumentsService,
    private readonly assertions: AssertionsService,
    private readonly transitions: TransitionsService,
    private readonly documents: DocumentsService,
    private readonly engine: DiscrepancyEngine,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly rules: RulesService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly trinetra: TrinetraService,
  ) {
    this.mockApi = new MockBankApiAdapter({
      latencyMs: config.MOCK_BANK_API_LATENCY_MS,
      failureRate: config.MOCK_BANK_API_FAILURE_RATE,
    });
  }

  /** Which integration channel serves a bank (BANK_ADAPTER: desk | mock-api | auto). */
  adapterFor(bank: Pick<Bank, 'apiEnabled'>): BankVerificationAdapter {
    switch (this.config.BANK_ADAPTER) {
      case 'desk':
        return this.desk;
      case 'mock-api':
        return this.mockApi;
      case 'auto':
        return bank.apiEnabled ? this.mockApi : this.desk;
    }
  }

  // ─── Regional Office side ──────────────────────────────────────────────────

  /** OFFICER_VERIFIED → BANK_CONFIRMATION_PENDING, with a request on the bank's desk or API. */
  async sendToBank(p: Principal, instrumentId: string): Promise<BankRequestView> {
    const inst = await this.instruments.getScoped(p, instrumentId);
    await this.instruments.assertAction(p, inst, 'send_to_bank');
    if (!inst.bankId)
      throw new ConflictError('The bank is not in the bank master; it cannot be asked to confirm');
    const bank = await this.prisma.bank.findUniqueOrThrow({ where: { id: inst.bankId } });
    const adapter = this.adapterFor(bank);
    const institution = await this.prisma.institution.findUniqueOrThrow({
      where: { id: inst.institutionId },
    });
    const sla = await this.rules.get('escalation.sla');
    const now = this.clock.now();
    const snapshot = snapshotOf(inst, institution.name);
    const actor = actorOf(p);
    const req = await this.prisma.$transaction(async (tx) => {
      const r = await tx.bankConfirmationRequest.create({
        data: {
          instrumentId,
          bankId: bank.id,
          channel: adapter.channel,
          requestedFields: ['exists', 'lienMarked', 'maturityDate', 'autoRenewal', 'amount'],
          snapshot: { ...snapshot },
          requestedById: p.id,
          slaDueAt: new Date(now.getTime() + sla.bankConfirmationDays * DAY_MS),
          createdAt: now,
        },
      });
      await this.transitions.transition(
        tx,
        inst,
        'BANK_CONFIRMATION_PENDING',
        actor,
        `Sent to ${bank.name} (${adapter.channel})`,
      );
      await this.audit.record(
        {
          actor,
          action: 'bank.requested',
          entityType: 'BankConfirmationRequest',
          entityId: r.id,
          data: { instrumentId, bank: bank.code, channel: adapter.channel },
        },
        tx,
      );
      if (adapter.channel === 'DESK') {
        await this.notifications.notifyInstrument(tx, instrumentId, ['BANK_OFFICER'], {
          kind: 'BANK',
          title: `AICTE requests confirmation of FDR ${inst.fdrNumber ?? ''}`,
          body: `Please confirm existence, lien in favour of AICTE, maturity date and auto-renewal for FDR ${inst.fdrNumber ?? ''} (${institution.name}) by ${toIso(r.slaDueAt)}.`,
          link: `/bank-desk/${r.id}`,
        });
      }
      return r;
    });
    if (adapter.channel === 'MOCK_API') await this.dispatch(req.id);
    return this.view(
      await this.prisma.bankConfirmationRequest.findUniqueOrThrow({
        where: { id: req.id },
        include: REQUEST_INCLUDE,
      }),
    );
  }

  /** Calls the bank API for a request; failures are recorded and can be retried. */
  async dispatch(requestId: string): Promise<void> {
    const req = await this.prisma.bankConfirmationRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { bank: true, instrument: true },
    });
    if (req.status === 'CONFIRMED' || req.status === 'DENIED') return;
    const adapter = this.adapterFor(req.bank);
    await this.prisma.bankConfirmationRequest.update({
      where: { id: requestId },
      data: { attempts: { increment: 1 }, status: 'PENDING', failureReason: null },
    });
    try {
      const res = await adapter.submit({
        requestId,
        bankCode: req.bank.code,
        fdrNumber: req.instrument.fdrNumber ?? '',
        ifsc: req.instrument.ifsc,
        amount: req.instrument.amount?.toFixed(2) ?? null,
        maturityDate: req.instrument.maturityDate ? toIso(req.instrument.maturityDate) : null,
        depositorNames: req.instrument.depositorNames,
      });
      if (res.kind === 'pending') return;
      await this.prisma.$transaction((tx) =>
        this.applyResponse(tx, requestId, res.response, SYSTEM_ACTOR, 'mock-bank-api', null),
      );
    } catch (e) {
      if (!(e instanceof BankApiError)) throw e;
      this.logger.warn(`Bank API failed for request ${requestId}: ${e.message}`);
      await this.prisma.bankConfirmationRequest.update({
        where: { id: requestId },
        data: { status: 'FAILED', failureReason: e.message },
      });
      await this.audit.record({
        actor: SYSTEM_ACTOR,
        action: 'bank.api_failed',
        entityType: 'BankConfirmationRequest',
        entityId: requestId,
        data: { reason: e.message, attempt: req.attempts + 1 },
      });
    }
  }

  async retry(p: Principal, requestId: string): Promise<BankRequestView> {
    const req = await this.getScoped(p, requestId);
    if (req.status !== 'FAILED') throw new ConflictError('Only failed API requests can be retried');
    await this.audit.record({
      actor: actorOf(p),
      action: 'bank.retry',
      entityType: 'BankConfirmationRequest',
      entityId: requestId,
    });
    await this.dispatch(requestId);
    return this.view(
      await this.prisma.bankConfirmationRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: REQUEST_INCLUDE,
      }),
    );
  }

  // ─── Bank desk ─────────────────────────────────────────────────────────────

  async list(p: Principal, q: BankRequestListQuery): Promise<Paged<BankRequestView>> {
    const where: Prisma.BankConfirmationRequestWhereInput = {
      AND: [bankRequestScope(p), q.status ? { status: q.status } : {}],
    };
    const [total, rows] = await Promise.all([
      this.prisma.bankConfirmationRequest.count({ where }),
      this.prisma.bankConfirmationRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: [{ status: 'asc' }, { slaDueAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: await toBankRequestViews(this.prisma, rows),
    };
  }

  private async getScoped(p: Principal, id: string): Promise<RequestRow> {
    const req = await this.prisma.bankConfirmationRequest.findFirst({
      where: { AND: [bankRequestScope(p), { id }] },
      include: REQUEST_INCLUDE,
    });
    if (!req) throw new NotFoundError('Confirmation request');
    return req;
  }

  async get(p: Principal, id: string): Promise<BankRequestView> {
    const req = await this.getScoped(p, id);
    await this.audit.record({
      actor: actorOf(p),
      action: 'bank.request_viewed',
      entityType: 'BankConfirmationRequest',
      entityId: id,
    });
    return this.view(req);
  }

  /** The bank officer attaches a signed confirmation letter. */
  async uploadLetter(
    p: Principal,
    id: string,
    file: UploadedFile,
  ): Promise<{ documentId: string }> {
    const req = await this.getScoped(p, id);
    this.assertOpen(req);
    const inst = await this.prisma.instrument.findUniqueOrThrow({
      where: { id: req.instrumentId },
    });
    const doc = await this.prisma.$transaction((tx) =>
      this.documents.store(tx, {
        file,
        type: 'BANK_LETTER',
        instrumentId: inst.id,
        institutionId: inst.institutionId,
        actor: actorOf(p),
      }),
    );
    return { documentId: doc.id };
  }

  /** The bank officer confirms or denies. */
  async respond(
    p: Principal,
    id: string,
    response: BankResponse,
    letterDocumentId?: string,
  ): Promise<BankRequestView> {
    const req = await this.getScoped(p, id);
    this.assertOpen(req);
    if (letterDocumentId) {
      const doc = await this.prisma.document.findFirst({
        where: { id: letterDocumentId, instrumentId: req.instrumentId, type: 'BANK_LETTER' },
      });
      if (!doc) throw new InvalidInputError('Unknown confirmation letter');
    }
    await this.prisma.$transaction((tx) =>
      this.applyResponse(tx, id, response, actorOf(p), 'bank-desk', letterDocumentId ?? null),
    );
    return this.view(
      await this.prisma.bankConfirmationRequest.findUniqueOrThrow({
        where: { id },
        include: REQUEST_INCLUDE,
      }),
    );
  }

  private assertOpen(req: BankConfirmationRequest): void {
    if (req.status !== 'PENDING' && req.status !== 'FAILED')
      throw new ConflictError('This request has already been answered');
  }

  /**
   * Records the bank's answer as BANK_CONFIRMED assertions, then either activates the instrument
   * or sends it back to scrutiny with a HIGH discrepancy listing what the bank contradicted.
   */
  async applyResponse(
    tx: Prisma.TransactionClient,
    requestId: string,
    response: BankResponse,
    actor: Actor,
    source: string,
    letterDocumentId: string | null,
  ): Promise<void> {
    const req = await tx.bankConfirmationRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { instrument: true },
    });
    const inst = req.instrument;
    const now = this.clock.now();
    const outcome = evaluateBankResponse(
      {
        fdrNumber: inst.fdrNumber,
        bankCode: inst.bankCode,
        amount: inst.amount?.toFixed(2) ?? null,
        maturityDate: inst.maturityDate ? toIso(inst.maturityDate) : null,
        lienMarked: inst.lienMarked,
        autoRenewal: inst.autoRenewal,
      },
      response,
    );
    await this.assertions.apply(
      tx,
      inst.id,
      outcome.assertions.map((a) => ({
        ...a,
        trust: 'BANK_CONFIRMED' as const,
        source,
        evidenceDocumentId: letterDocumentId,
      })),
      actor,
    );
    await tx.bankConfirmationRequest.update({
      where: { id: requestId },
      data: {
        status: outcome.outcome,
        response: { ...response },
        respondedById: actor.id,
        respondedAt: now,
        letterDocumentId,
        failureReason: null,
      },
    });
    await this.audit.record(
      {
        actor,
        action: outcome.outcome === 'CONFIRMED' ? 'bank.confirmed' : 'bank.denied',
        entityType: 'BankConfirmationRequest',
        entityId: requestId,
        data: {
          instrumentId: inst.id,
          source,
          contradictions: outcome.contradictions,
          reference: response.reference,
        },
      },
      tx,
    );

    // TRINETRA bank eye.
    await this.trinetra.recordBank(
      tx,
      inst.id,
      outcome.outcome === 'CONFIRMED',
      {
        requestId,
        purpose: req.purpose,
        source,
        reference: response.reference,
        contradictions: outcome.contradictions,
      },
      letterDocumentId,
      actor,
    );

    if (req.purpose === 'REATTESTATION') {
      await this.afterReattestation(tx, req.id, inst, outcome, response, actor, now);
      return;
    }

    const transitionActor: Actor = actor.role === 'BANK_OFFICER' ? actor : SYSTEM_ACTOR;
    if (outcome.outcome === 'CONFIRMED') {
      const confirmed = await this.transitions.transition(
        tx,
        inst,
        'BANK_CONFIRMED',
        transitionActor,
        response.remarks,
      );
      const active = await this.transitions.transition(tx, confirmed, 'ACTIVE', SYSTEM_ACTOR);
      await this.engine.sync(tx, inst.id, actor);
      await this.instruments.onActivated(tx, active, SYSTEM_ACTOR);
    } else {
      const sla = (await this.rules.current(now, tx))['escalation.sla'];
      await tx.discrepancy.create({
        data: {
          instrumentId: inst.id,
          ruleCode: BANK_DENIAL_CODE,
          severity: 'HIGH',
          description: `Bank did not confirm: ${outcome.contradictions.join('; ')}${response.remarks ? ` — "${response.remarks}"` : ''}`,
          raisedById: actor.id,
          dueAt: new Date(now.getTime() + sla.discrepancyResponseDays * DAY_MS),
          createdAt: now,
        },
      });
      await this.transitions.transition(
        tx,
        inst,
        'UNDER_SCRUTINY',
        transitionActor,
        outcome.contradictions.join('; '),
      );
      await this.engine.sync(tx, inst.id, actor);
      await this.notifications.notifyInstrument(tx, inst.id, ['RO_OFFICER', 'INSTITUTION_USER'], {
        kind: 'BANK',
        title: `Bank did not confirm ${inst.refNo}`,
        body: outcome.contradictions.join('\n'),
        sms: true,
      });
    }
  }

  /** A re-attestation answer never moves the lifecycle; it clears or raises the alarm. */
  private async afterReattestation(
    tx: Prisma.TransactionClient,
    requestId: string,
    inst: { id: string; refNo: string },
    outcome: { outcome: 'CONFIRMED' | 'DENIED'; contradictions: string[] },
    response: BankResponse,
    actor: Actor,
    now: Date,
  ): Promise<void> {
    if (outcome.outcome === 'CONFIRMED') {
      // The bank re-attested: the tax-heartbeat alarm is answered.
      const tax = await tx.discrepancy.findMany({
        where: {
          instrumentId: inst.id,
          ruleCode: TAX_TRAIL_CODE,
          status: { in: ['OPEN', 'RESPONDED'] },
        },
      });
      for (const d of tax) {
        await tx.discrepancy.update({
          where: { id: d.id },
          data: { status: 'RESOLVED', resolvedAt: now, resolvedById: null },
        });
        await this.audit.record(
          {
            actor,
            action: 'discrepancy.auto_resolved',
            entityType: 'Discrepancy',
            entityId: d.id,
            data: { instrumentId: inst.id, reason: 'bank re-attested', bankRequestId: requestId },
          },
          tx,
        );
      }
      await this.trinetra.rescore(tx, inst.id);
      await this.notifications.notifyInstrument(tx, inst.id, ['RO_OFFICER'], {
        kind: 'BANK',
        title: `Bank re-attested ${inst.refNo}`,
        body: 'The bank confirmed the deposit still exists with lien in favour of AICTE.',
      });
      return;
    }
    const sla = (await this.rules.current(now, tx))['escalation.sla'];
    await tx.discrepancy.create({
      data: {
        instrumentId: inst.id,
        ruleCode: BANK_DENIAL_CODE,
        severity: 'HIGH',
        description: `Bank did not re-attest: ${outcome.contradictions.join('; ')}${response.remarks ? ` (bank remarks: ${response.remarks})` : ''}`,
        raisedById: actor.id,
        dueAt: new Date(now.getTime() + sla.discrepancyResponseDays * DAY_MS),
        createdAt: now,
      },
    });
    await this.trinetra.rescore(tx, inst.id);
    await this.notifications.notifyInstrument(
      tx,
      inst.id,
      ['RO_OFFICER', 'INSTITUTION_USER', 'BUREAU_OFFICER'],
      {
        kind: 'BANK',
        title: `Bank did not re-attest ${inst.refNo}`,
        body: outcome.contradictions.join('; '),
        sms: true,
      },
    );
  }

  private async view(r: RequestRow): Promise<BankRequestView> {
    return (await toBankRequestViews(this.prisma, [r]))[0]!;
  }

  /**
   * Re-attestation (TRINETRA bank eye): asks the bank to confirm an ACTIVE deposit again without
   * changing its lifecycle state. Used by officers, the daily stale-signal job and a tax FAIL.
   * Returns the new request id, or null when one is already open or the bank is unknown.
   */
  async createReattestation(
    tx: Prisma.TransactionClient,
    instrumentId: string,
    reason: string,
    by: Principal | null,
  ): Promise<string | null> {
    const inst = await tx.instrument.findUniqueOrThrow({
      where: { id: instrumentId },
      include: { institution: { select: { name: true } }, bank: true },
    });
    if (!inst.bank) return null;
    const open = await tx.bankConfirmationRequest.count({
      where: { instrumentId, status: { in: ['PENDING', 'FAILED'] } },
    });
    if (open) return null;
    const adapter = this.adapterFor(inst.bank);
    const now = this.clock.now();
    const sla = (await this.rules.current(now, tx))['escalation.sla'];
    const r = await tx.bankConfirmationRequest.create({
      data: {
        instrumentId,
        bankId: inst.bank.id,
        channel: adapter.channel,
        purpose: 'REATTESTATION',
        reason,
        requestedFields: ['exists', 'lienMarked', 'maturityDate', 'autoRenewal', 'amount'],
        snapshot: { ...snapshotOf(inst, inst.institution.name) },
        requestedById: by?.id ?? null,
        slaDueAt: new Date(now.getTime() + sla.bankConfirmationDays * DAY_MS),
        createdAt: now,
      },
    });
    await this.audit.record(
      {
        actor: by ? actorOf(by) : SYSTEM_ACTOR,
        action: 'bank.reattestation_requested',
        entityType: 'BankConfirmationRequest',
        entityId: r.id,
        data: { instrumentId, bank: inst.bank.code, reason },
      },
      tx,
    );
    if (adapter.channel === 'DESK') {
      await this.notifications.notifyInstrument(tx, instrumentId, ['BANK_OFFICER'], {
        kind: 'BANK',
        title: `AICTE asks you to re-confirm FDR ${inst.fdrNumber ?? ''}`,
        body: `${reason}. Please confirm the deposit still exists with lien in favour of AICTE (${inst.institution.name}) by ${toIso(r.slaDueAt)}.`,
        link: `/bank-desk/${r.id}`,
      });
    }
    return r.id;
  }

  /** Creates a re-attestation request and, for API banks, sends it at once. */
  async requestReattestation(
    instrumentId: string,
    reason: string,
    by: Principal | null,
  ): Promise<string | null> {
    const id = await this.prisma.$transaction((tx) =>
      this.createReattestation(tx, instrumentId, reason, by),
    );
    if (id) await this.dispatchIfApi(id);
    return id;
  }

  async dispatchIfApi(requestId: string): Promise<void> {
    const r = await this.prisma.bankConfirmationRequest.findUnique({ where: { id: requestId } });
    if (r?.channel === 'MOCK_API') await this.dispatch(requestId);
  }

  /** Officer action: ask the bank to re-confirm a held deposit. */
  async reattestByOfficer(
    p: Principal,
    instrumentId: string,
    reason: string,
  ): Promise<BankRequestView> {
    const inst = await this.instruments.getScoped(p, instrumentId);
    await this.instruments.assertAction(p, inst, 'reattest');
    const id = await this.requestReattestation(instrumentId, reason, p);
    if (!id) {
      throw new ConflictError(
        'A bank request is already open for this instrument, or its bank is unknown',
      );
    }
    return this.view(
      await this.prisma.bankConfirmationRequest.findUniqueOrThrow({
        where: { id },
        include: REQUEST_INCLUDE,
      }),
    );
  }
}

function snapshotOf(
  inst: {
    refNo: string;
    fdrNumber: string | null;
    ifsc: string | null;
    branch: string | null;
    amount: Prisma.Decimal | null;
    issueDate: Date | null;
    maturityDate: Date | null;
    depositorNames: string | null;
    lienMarked: boolean;
    autoRenewal: boolean;
  },
  institutionName: string,
): BankSnapshot {
  return {
    refNo: inst.refNo,
    institutionName,
    fdrNumber: inst.fdrNumber,
    ifsc: inst.ifsc,
    branch: inst.branch,
    amount: inst.amount?.toFixed(2) ?? null,
    issueDate: inst.issueDate ? toIso(inst.issueDate) : null,
    maturityDate: inst.maturityDate ? toIso(inst.maturityDate) : null,
    depositorNames: inst.depositorNames,
    lienMarked: inst.lienMarked,
    autoRenewal: inst.autoRenewal,
  };
}
