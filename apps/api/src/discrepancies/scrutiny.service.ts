import { Injectable } from '@nestjs/common';
import { FIELD_KEYS, TRUST_LEVELS, type VerifyFieldsInput } from '@nidhisetu/shared';
import { actorOf } from '../common/actor.js';
import { ConflictError, InvalidInputError } from '../domain/errors.js';
import type { Principal } from '../domain/scope.js';
import { TRUST_RANK, computeFieldStates } from '../domain/trust.js';
import { AssertionsService } from '../instruments/assertions.service.js';
import { InstrumentsService } from '../instruments/instruments.service.js';
import { TransitionsService } from '../instruments/transitions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Regional Office scrutiny actions (Section 7 · cap 3). */
@Injectable()
export class ScrutinyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instruments: InstrumentsService,
    private readonly assertions: AssertionsService,
    private readonly transitions: TransitionsService,
  ) {}

  async begin(p: Principal, id: string) {
    const inst = await this.instruments.getScoped(p, id);
    await this.instruments.assertAction(p, inst, 'begin_scrutiny');
    await this.prisma.$transaction((tx) =>
      this.transitions.transition(tx, inst, 'UNDER_SCRUTINY', actorOf(p)),
    );
  }

  /**
   * "Verify field": the officer has checked the value against the original FDR. Without a value
   * the current effective value is confirmed; with one, the officer's reading is recorded.
   */
  async verifyFields(p: Principal, id: string, input: VerifyFieldsInput) {
    const inst = await this.instruments.getScoped(p, id);
    await this.instruments.assertAction(p, inst, 'verify_field');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      const states = computeFieldStates(
        await tx.fieldAssertion.findMany({ where: { instrumentId: id } }),
      );
      const scan = await tx.document.findFirst({
        where: { instrumentId: id, type: 'FDR_SCAN' },
        orderBy: { version: 'desc' },
      });
      const items = input.items.map((i) => {
        const value = i.value ?? states[i.field].effectiveValue;
        if (value === null || value === '')
          throw new InvalidInputError(`Nothing to verify for ${i.field}`);
        return {
          field: i.field,
          value,
          trust: 'OFFICER_VERIFIED' as const,
          source: i.value === undefined ? 'officer (confirmed)' : 'officer (corrected)',
          evidenceDocumentId: scan?.id ?? null,
        };
      });
      await this.assertions.apply(tx, id, items, actor);
      await this.instruments.afterChange(tx, id, actor);
    });
  }

  /** UNDER_SCRUTINY → OFFICER_VERIFIED: every key field verified and no unresolved discrepancy. */
  async markVerified(p: Principal, id: string) {
    const inst = await this.instruments.getScoped(p, id);
    await this.instruments.assertAction(p, inst, 'verify');
    const states = computeFieldStates(
      await this.prisma.fieldAssertion.findMany({ where: { instrumentId: id } }),
    );
    const officerRank = TRUST_RANK[TRUST_LEVELS[2]];
    const missing = FIELD_KEYS.filter((f) => {
      const t = states[f].effectiveTrust;
      return !t || TRUST_RANK[t] < officerRank || states[f].mismatch;
    });
    if (missing.length) {
      throw new ConflictError(
        `Verify these fields first: ${missing.join(', ')}`,
        'FieldsNotVerified',
      );
    }
    await this.prisma.$transaction((tx) =>
      this.transitions.transition(tx, inst, 'OFFICER_VERIFIED', actorOf(p)),
    );
  }

  async reject(p: Principal, id: string, note: string) {
    const inst = await this.instruments.getScoped(p, id);
    await this.instruments.assertAction(p, inst, 'reject');
    const actor = actorOf(p);
    await this.prisma.$transaction(async (tx) => {
      await this.transitions.transition(tx, inst, 'REJECTED', actor, note);
      await tx.discrepancy.updateMany({
        where: { instrumentId: id, status: { in: ['OPEN', 'RESPONDED'] } },
        data: { status: 'WAIVED', resolvedAt: new Date(), resolvedById: p.id },
      });
      if (inst.replacesInstrumentId)
        await this.instruments.onReplacementRejected(tx, inst.replacesInstrumentId, actor);
    });
  }
}
