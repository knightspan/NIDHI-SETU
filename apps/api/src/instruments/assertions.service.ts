import { Injectable } from '@nestjs/common';
import {
  AICTE_BENEFICIARY,
  normalizeFieldValue,
  type AssertedField,
  type FieldKey,
  type TrustLevel,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { dateOnly } from '../domain/dates.js';
import {
  computeFieldState,
  computeFieldStates,
  mismatchedFields,
  type FieldState,
} from '../domain/trust.js';
import { fdrKey } from '../domain/fdr-key.js';
import type { Prisma } from '../generated/prisma/client.js';

/** People who type values (bank answers and OCR are not manual effort). */
const MANUAL_ROLES = new Set(['INSTITUTION_USER', 'RO_OFFICER']);

export interface AssertionInput {
  field: AssertedField;
  value: unknown;
  trust: TrustLevel;
  source: string;
  confidence?: number | null;
  evidenceDocumentId?: string | null;
}

/**
 * Records field assertions (Section 3.1) and keeps the instrument's denormalised "effective" columns,
 * trust score and mismatch count in step with them.
 */
@Injectable()
export class AssertionsService {
  constructor(
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Inserts assertions. A new assertion is skipped when the latest assertion for that field at the
   * same trust level already carries the same value (keeps history meaningful).
   */
  async apply(
    tx: Prisma.TransactionClient,
    instrumentId: string,
    inputs: AssertionInput[],
    actor: Actor,
  ): Promise<{ states: Record<FieldKey, FieldState>; added: number }> {
    const existing = await tx.fieldAssertion.findMany({ where: { instrumentId } });
    const now = this.clock.now();
    const rows: Prisma.FieldAssertionCreateManyInput[] = [];
    for (const i of inputs) {
      const value = normalizeFieldValue(i.field, i.value);
      const latestSame = existing
        .filter((e) => e.field === i.field && e.trust === i.trust)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (latestSame?.value === value) continue;
      rows.push({
        instrumentId,
        field: i.field,
        value,
        trust: i.trust,
        actorId: actor.id,
        source: i.source,
        confidence: i.confidence ?? null,
        evidenceDocumentId: i.evidenceDocumentId ?? null,
        createdAt: now,
      });
    }
    if (rows.length) await tx.fieldAssertion.createMany({ data: rows });
    // Manual effort metric: a person typing over a value that was already on record.
    if (actor.role && MANUAL_ROLES.has(actor.role)) {
      const edited = rows.filter((r) => {
        const prior = computeFieldState(r.field as AssertedField, existing).effectiveValue;
        return prior !== null && prior !== r.value;
      });
      if (edited.length) {
        await this.audit.record(
          edited.map((r) => ({
            actor,
            action: 'field.edited',
            entityType: 'Instrument',
            entityId: instrumentId,
            data: { field: r.field, trust: r.trust, source: r.source },
          })),
          tx,
        );
      }
    }
    const states = await this.refresh(tx, instrumentId);
    return { states, added: rows.length };
  }

  /** Recomputes effective values from all assertions and writes them to the instrument row. */
  async refresh(
    tx: Prisma.TransactionClient,
    instrumentId: string,
  ): Promise<Record<FieldKey, FieldState>> {
    const all = await tx.fieldAssertion.findMany({ where: { instrumentId } });
    const states = computeFieldStates(all);
    const v = (f: FieldKey) => states[f].effectiveValue;
    const bankCode = v('bankCode');
    const bank = bankCode ? await tx.bank.findUnique({ where: { code: bankCode } }) : null;
    const amount = v('amount');
    const names = v('depositorNames');
    await tx.instrument.update({
      where: { id: instrumentId },
      data: {
        fdrNumber: v('fdrNumber'),
        fdrKey: fdrKey(bankCode, v('fdrNumber')),
        bankCode,
        bankId: bank?.id ?? null,
        ifsc: v('ifsc'),
        amount: amount && Number.isFinite(Number(amount)) ? amount : null,
        issueDate: validDate(v('issueDate')),
        maturityDate: validDate(v('maturityDate')),
        depositorNames: names,
        jointName: !!names && names.split(';').some((n) => n.trim() === AICTE_BENEFICIARY),
        lienMarked: v('lienMarked') === 'true',
        autoRenewal: v('autoRenewal') === 'true',
        interestRate: num(computeFieldState('interestRate', all).effectiveValue),
        maturityValue: num(computeFieldState('maturityValue', all).effectiveValue),
        mismatchCount: mismatchedFields(states).length,
      },
    });
    return states;
  }
}

function num(v: string | null): string | null {
  return v && Number.isFinite(Number(v)) ? v : null;
}

function validDate(iso: string | null): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = dateOnly(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
