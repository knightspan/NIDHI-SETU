import type { ForfeitureView } from '@nidhisetu/shared';
import { toIso } from '../domain/dates.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../prisma/prisma.service.js';

export const FORFEITURE_INCLUDE = {
  instrument: { select: { refNo: true, amount: true, institution: { select: { name: true } } } },
} satisfies Prisma.ForfeitureRequestInclude;
export type ForfeitureRow = Prisma.ForfeitureRequestGetPayload<{
  include: typeof FORFEITURE_INCLUDE;
}>;

export async function toForfeitureViews(db: Db, rows: ForfeitureRow[]): Promise<ForfeitureView[]> {
  const ids = [
    ...new Set(
      rows
        .flatMap((r) => [r.proposedById, r.decidedById, r.executedById])
        .filter((x): x is string => !!x),
    ),
  ];
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  const n = (id: string | null) => (id ? (name.get(id) ?? null) : null);
  return rows.map((r) => ({
    id: r.id,
    instrumentId: r.instrumentId,
    refNo: r.instrument.refNo,
    institutionName: r.instrument.institution.name,
    amount: r.instrument.amount?.toFixed(2) ?? null,
    status: r.status,
    reason: r.reason,
    orderReference: r.orderReference,
    proposedBy: n(r.proposedById),
    proposedById: r.proposedById,
    proposedAt: r.proposedAt.toISOString(),
    decidedBy: n(r.decidedById),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    executedBy: n(r.executedById),
    executedAt: r.executedAt?.toISOString() ?? null,
    executionRef: r.executionRef,
    executionDate: r.executionDate ? toIso(r.executionDate) : null,
  }));
}

export async function forfeituresForInstrument(
  db: Db,
  instrumentId: string,
): Promise<ForfeitureView[]> {
  const rows = await db.forfeitureRequest.findMany({
    where: { instrumentId },
    include: FORFEITURE_INCLUDE,
    orderBy: { proposedAt: 'desc' },
  });
  return toForfeitureViews(db, rows);
}
