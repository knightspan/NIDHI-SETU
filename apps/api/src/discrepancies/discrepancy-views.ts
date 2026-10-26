import type { DiscrepancyView, FieldKey } from '@nidhisetu/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../prisma/prisma.service.js';

export const DISCREPANCY_INCLUDE = {
  instrument: { select: { refNo: true, institution: { select: { name: true } } } },
  comments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.DiscrepancyInclude;

type Row = Prisma.DiscrepancyGetPayload<{ include: typeof DISCREPANCY_INCLUDE }>;

export async function toDiscrepancyViews(db: Db, rows: Row[]): Promise<DiscrepancyView[]> {
  const ids = new Set(
    rows.flatMap((r) => r.comments.map((c) => c.authorId).filter((x): x is string => !!x)),
  );
  const users = ids.size
    ? await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    instrumentId: r.instrumentId,
    refNo: r.instrument.refNo,
    institutionName: r.instrument.institution.name,
    ruleCode: r.ruleCode,
    field: r.field as FieldKey | null,
    severity: r.severity,
    description: r.description,
    status: r.status,
    autoRaised: r.autoRaised,
    dueAt: r.dueAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    comments: r.comments.map((c) => ({
      id: c.id,
      authorName: c.authorId ? (names.get(c.authorId) ?? null) : null,
      authorRole: c.authorRole,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
  }));
}
