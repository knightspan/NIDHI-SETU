import { Injectable } from '@nestjs/common';
import { assertTransition, type LifecycleStatus } from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { ConflictError } from '../domain/errors.js';
import { TrinetraService } from './trinetra.service.js';
import type { Instrument, Prisma } from '../generated/prisma/client.js';

/** Timestamps set when an instrument enters a state. */
const STAMPS: Partial<Record<LifecycleStatus, keyof Prisma.InstrumentUpdateInput>> = {
  SUBMITTED: 'submittedAt',
  UNDER_SCRUTINY: 'scrutinyStartedAt',
  OFFICER_VERIFIED: 'verifiedAt',
  ACTIVE: 'activatedAt',
  RENEWED: 'closedAt',
  RELEASED: 'closedAt',
  REJECTED: 'closedAt',
  FORFEITED: 'closedAt',
};

/**
 * The only way an instrument changes lifecycle status. Validates against the shared state machine
 * (illegal → IllegalTransitionError → HTTP 409), logs the transition and audits it atomically.
 */
@Injectable()
export class TransitionsService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly trinetra: TrinetraService,
  ) {}

  async transition(
    tx: Prisma.TransactionClient,
    instrument: Pick<Instrument, 'id' | 'status' | 'refNo'>,
    to: LifecycleStatus,
    actor: Actor,
    note?: string | null,
  ): Promise<Instrument> {
    const from = instrument.status;
    const def = assertTransition(from, to, actor.role);
    // Gates belong to the state machine: every path into the state is checked here, not in the UI.
    if (def.gate === 'REVERIFICATION') {
      const gate = await this.trinetra.gate(tx, instrument.id);
      if (!gate.passed) {
        throw new ConflictError(
          `Re-verification required: ${gate.failures.map((f) => f.message).join('; ')}`,
          'ReverificationGateFailed',
        );
      }
    }
    const now = this.clock.now();
    const stamp = STAMPS[to];
    // Optimistic concurrency: the update only applies if nobody moved the instrument meanwhile.
    const res = await tx.instrument.updateMany({
      where: { id: instrument.id, status: from },
      data: {
        status: to,
        statusChangedAt: now,
        // Entering a state stamps its time; SUBMITTED keeps the first submission time.
        ...(stamp && (to !== 'SUBMITTED' || from === 'DRAFT') ? { [stamp]: now } : {}),
      },
    });
    if (res.count !== 1) {
      throw new ConflictError(
        'The instrument was changed by someone else; reload and try again',
        'StaleState',
      );
    }
    await tx.statusTransition.create({
      data: {
        instrumentId: instrument.id,
        from,
        to,
        action: def.action,
        actorId: actor.id,
        actorRole: actor.role,
        note: note ?? null,
        at: now,
      },
    });
    await this.audit.record(
      {
        actor,
        action: `instrument.${def.action}`,
        entityType: 'Instrument',
        entityId: instrument.id,
        data: { refNo: instrument.refNo, from, to, note: note ?? undefined },
      },
      tx,
    );
    return tx.instrument.findUniqueOrThrow({ where: { id: instrument.id } });
  }
}
