import type { BankRequestView, BankResponse, BankSnapshot } from '@nidhisetu/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../prisma/prisma.service.js';

export const REQUEST_INCLUDE = { bank: true } satisfies Prisma.BankConfirmationRequestInclude;
export type RequestRow = Prisma.BankConfirmationRequestGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;

export async function toBankRequestViews(db: Db, rows: RequestRow[]): Promise<BankRequestView[]> {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.requestedById, r.respondedById]).filter((x): x is string => !!x),
    ),
  ];
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    instrumentId: r.instrumentId,
    bankCode: r.bank.code,
    bankName: r.bank.name,
    channel: r.channel,
    status: r.status,
    snapshot: r.snapshot as unknown as BankSnapshot,
    response: (r.response as BankResponse | null) ?? null,
    requestedBy: names.get(r.requestedById) ?? null,
    respondedBy: r.respondedById
      ? (names.get(r.respondedById) ?? null)
      : r.respondedAt
        ? 'Bank API'
        : null,
    createdAt: r.createdAt.toISOString(),
    slaDueAt: r.slaDueAt.toISOString(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
    failureReason: r.failureReason,
    attempts: r.attempts,
    letterDocumentId: r.letterDocumentId,
  }));
}

export async function bankRequestsForInstrument(
  db: Db,
  instrumentId: string,
): Promise<BankRequestView[]> {
  const rows = await db.bankConfirmationRequest.findMany({
    where: { instrumentId },
    include: REQUEST_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return toBankRequestViews(db, rows);
}
