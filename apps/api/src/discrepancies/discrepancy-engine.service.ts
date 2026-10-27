import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { SYSTEM_ACTOR, type Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { DAY_MS } from '../domain/dates.js';
import { evaluateDiscrepancyRules, type Finding } from '../domain/discrepancy-rules.js';
import { computeFieldStates } from '../domain/trust.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RulesService } from '../rules/rules.service.js';

/** Statuses whose instrument counts towards an institution's live deposit total. */
const LIVE_STATUSES = [
  'SUBMITTED',
  'UNDER_SCRUTINY',
  'DISCREPANCY_RAISED',
  'OFFICER_VERIFIED',
  'BANK_CONFIRMATION_PENDING',
  'BANK_CONFIRMED',
  'ACTIVE',
  'RENEWAL_PENDING',
  'RELEASE_REQUESTED',
  'RELEASE_RECOMMENDED',
  'RELEASE_APPROVED',
] as const;

export interface SyncResult {
  created: { id: string; code: string; severity: string; description: string }[];
  resolved: string[];
}

/**
 * Runs the discrepancy rules against an instrument and reconciles the result with stored
 * discrepancies: new findings are raised, cleared automatic findings are auto-resolved.
 * Officer-closed (resolved / waived) findings are never re-raised for the same key.
 */
@Injectable()
export class DiscrepancyEngine {
  constructor(
    private readonly rules: RulesService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async findings(tx: Prisma.TransactionClient, instrumentId: string): Promise<Finding[] | null> {
    const inst = await tx.instrument.findUniqueOrThrow({
      where: { id: instrumentId },
      include: {
        institution: true,
        assertions: true,
        documents: { select: { type: true, sha256: true } },
        replacedBy: { select: { id: true } },
      },
    });
    if (inst.status === 'DRAFT') return null;
    const now = this.clock.now();
    const rules = await this.rules.current(now, tx);

    const exclude = [inst.id, inst.replacesInstrumentId, inst.replacedBy?.id].filter(
      (x): x is string => !!x,
    );
    const others = await tx.instrument.aggregate({
      where: {
        institutionId: inst.institutionId,
        id: { notIn: exclude },
        status: { in: [...LIVE_STATUSES] },
      },
      _sum: { amount: true },
    });

    const duplicateFdrs = inst.fdrKey
      ? await tx.instrument.findMany({
          where: {
            fdrKey: inst.fdrKey,
            id: { not: inst.id },
            institutionId: { not: inst.institutionId },
            status: { not: 'DRAFT' },
          },
          select: { refNo: true, institution: { select: { name: true } } },
        })
      : [];

    const hashes = inst.documents.map((d) => d.sha256);
    const dupDocs = hashes.length
      ? await tx.document.findMany({
          where: {
            sha256: { in: hashes },
            instrumentId: { notIn: exclude },
            NOT: { instrumentId: null },
          },
          select: { type: true, instrument: { select: { refNo: true } } },
        })
      : [];

    const banks = await tx.bank.findMany({ select: { code: true } });

    return evaluateDiscrepancyRules({
      states: computeFieldStates(inst.assertions),
      institution: {
        yearEstablished: inst.institution.yearEstablished,
        programmes: inst.institution.programmes,
      },
      today: this.clock.today(),
      rules: {
        eligibility: rules['eligibility.exemption'],
        amount: rules['amount.required'],
        validity: rules['validity.window'],
        discrepancy: rules['discrepancy.rules'],
      },
      otherHeldAmount: Number(others._sum.amount ?? 0),
      duplicateFdrs: duplicateFdrs.map((d) => ({
        refNo: d.refNo,
        institutionName: d.institution.name,
      })),
      duplicateDocuments: dupDocs.map((d) => ({
        documentType: d.type,
        otherRefNo: d.instrument!.refNo,
      })),
      knownBankCodes: new Set(banks.map((b) => b.code)),
      documentTypes: new Set(inst.documents.map((d) => d.type)),
      submitted: true,
    });
  }

  async sync(
    tx: Prisma.TransactionClient,
    instrumentId: string,
    actor: Actor = SYSTEM_ACTOR,
    cascade = true,
  ): Promise<SyncResult> {
    const result: SyncResult = { created: [], resolved: [] };
    const findings = await this.findings(tx, instrumentId);
    if (!findings) return result;

    const now = this.clock.now();
    const sla = (await this.rules.current(now, tx))['escalation.sla'];
    const existing = await tx.discrepancy.findMany({ where: { instrumentId, autoRaised: true } });
    const byKey = new Map(existing.map((d) => [d.key, d]));
    const currentKeys = new Set(findings.map((f) => f.key));

    for (const f of findings) {
      if (byKey.has(f.key)) continue;
      const d = await tx.discrepancy.create({
        data: {
          instrumentId,
          ruleCode: f.code,
          key: f.key,
          field: f.field,
          severity: f.severity,
          description: f.description,
          autoRaised: true,
          dueAt: new Date(now.getTime() + sla.discrepancyResponseDays * DAY_MS),
          createdAt: now,
        },
      });
      result.created.push({
        id: d.id,
        code: f.code,
        severity: f.severity,
        description: f.description,
      });
    }

    for (const d of existing) {
      if ((d.status === 'OPEN' || d.status === 'RESPONDED') && d.key && !currentKeys.has(d.key)) {
        await tx.discrepancy.update({
          where: { id: d.id },
          data: { status: 'RESOLVED', resolvedAt: now, resolvedById: null },
        });
        await tx.discrepancyComment.create({
          data: {
            discrepancyId: d.id,
            authorId: null,
            authorRole: 'SYSTEM',
            body: 'Automatically resolved: the condition is no longer present.',
            createdAt: now,
          },
        });
        result.resolved.push(d.id);
      }
    }

    if (result.created.length || result.resolved.length) {
      await this.audit.record(
        [
          ...result.created.map((c) => ({
            actor: SYSTEM_ACTOR,
            action: 'discrepancy.auto_raised',
            entityType: 'Discrepancy',
            entityId: c.id,
            data: { instrumentId, code: c.code, severity: c.severity, triggeredBy: actor.id },
          })),
          ...result.resolved.map((id) => ({
            actor: SYSTEM_ACTOR,
            action: 'discrepancy.auto_resolved',
            entityType: 'Discrepancy',
            entityId: id,
            data: { instrumentId },
          })),
        ],
        tx,
      );
      if (result.created.length) {
        const inst = await tx.instrument.findUniqueOrThrow({
          where: { id: instrumentId },
          select: { refNo: true },
        });
        const dup = result.created.filter((c) => c.code === 'DUPLICATE_FDR');
        await this.notifications.notifyInstrument(
          tx,
          instrumentId,
          ['INSTITUTION_USER', 'RO_OFFICER'],
          {
            kind: 'DISCREPANCY',
            title: `${result.created.length} discrepanc${result.created.length === 1 ? 'y' : 'ies'} detected on ${inst.refNo}`,
            body: result.created.map((c) => `• [${c.severity}] ${c.description}`).join('\n'),
            sms: dup.length > 0,
          },
        );
        if (dup.length) {
          await this.notifications.notifyInstrument(tx, instrumentId, ['BUREAU_OFFICER'], {
            kind: 'DISCREPANCY',
            title: `Fraud signal: duplicate FDR on ${inst.refNo}`,
            body: dup.map((c) => c.description).join('\n'),
          });
        }
      }
    }

    // A duplicate FDR is a two-sided fraud signal: flag the other instrument(s) too.
    if (cascade && findings.some((f) => f.code === 'DUPLICATE_FDR')) {
      const inst = await tx.instrument.findUniqueOrThrow({ where: { id: instrumentId } });
      const twins = await tx.instrument.findMany({
        where: {
          fdrKey: inst.fdrKey,
          id: { not: instrumentId },
          status: { not: 'DRAFT' },
        },
        select: { id: true },
      });
      for (const t of twins) await this.sync(tx, t.id, actor, false);
    }
    return result;
  }
}
