import type { ReleaseChecklistItem, ReleaseView } from '@nidhisetu/shared';
import { toIso } from '../domain/dates.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../prisma/prisma.service.js';

export const RELEASE_INCLUDE = {
  instrument: { select: { refNo: true, amount: true, institution: { select: { name: true } } } },
} satisfies Prisma.ReleaseRequestInclude;
export type ReleaseRow = Prisma.ReleaseRequestGetPayload<{ include: typeof RELEASE_INCLUDE }>;

export async function toReleaseViews(db: Db, rows: ReleaseRow[]): Promise<ReleaseView[]> {
  const ids = [
    ...new Set(
      rows
        .flatMap((r) => [r.requestedById, r.recommendedById, r.decidedById, r.executedById])
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
    reason: r.reason,
    status: r.status,
    checklist: r.checklist as unknown as ReleaseChecklistItem[],
    checklistPassed: r.checklistPassed,
    requestedBy: n(r.requestedById),
    requestedAt: r.requestedAt.toISOString(),
    recommendedBy: n(r.recommendedById),
    recommendedById: r.recommendedById,
    recommendedAt: r.recommendedAt?.toISOString() ?? null,
    recommendationNote: r.recommendationNote,
    decidedBy: n(r.decidedById),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    executionRef: r.executionRef,
    executionDate: r.executionDate ? toIso(r.executionDate) : null,
    executedBy: n(r.executedById),
    executedAt: r.executedAt?.toISOString() ?? null,
  }));
}

export async function releasesForInstrument(db: Db, instrumentId: string): Promise<ReleaseView[]> {
  const rows = await db.releaseRequest.findMany({
    where: { instrumentId },
    include: RELEASE_INCLUDE,
    orderBy: { requestedAt: 'desc' },
  });
  return toReleaseViews(db, rows);
}
