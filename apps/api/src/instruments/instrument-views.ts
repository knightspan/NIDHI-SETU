import type { InstrumentSummary } from '@nidhisetu/shared';
import { toIso } from '../domain/dates.js';
import type { Prisma } from '../generated/prisma/client.js';

export const UNRESOLVED_DISCREPANCY = {
  status: { in: ['OPEN', 'RESPONDED'] },
} satisfies Prisma.DiscrepancyWhereInput;

/** Relations needed to render an InstrumentSummary. */
export const SUMMARY_INCLUDE = {
  institution: {
    select: { id: true, name: true, aicteId: true, region: { select: { name: true } } },
  },
  bank: { select: { name: true } },
  _count: { select: { discrepancies: { where: UNRESOLVED_DISCREPANCY } } },
} satisfies Prisma.InstrumentInclude;

export type InstrumentWithSummary = Prisma.InstrumentGetPayload<{
  include: typeof SUMMARY_INCLUDE;
}>;

export function toSummary(i: InstrumentWithSummary): InstrumentSummary {
  return {
    id: i.id,
    refNo: i.refNo,
    type: i.type,
    status: i.status,
    validityStatus: i.validityStatus,
    institution: {
      id: i.institution.id,
      name: i.institution.name,
      aicteId: i.institution.aicteId,
      regionName: i.institution.region.name,
    },
    bankCode: i.bankCode,
    bankName: i.bank?.name ?? null,
    fdrNumber: i.fdrNumber,
    amount: i.amount?.toFixed(2) ?? null,
    issueDate: i.issueDate ? toIso(i.issueDate) : null,
    maturityDate: i.maturityDate ? toIso(i.maturityDate) : null,
    trustScore: i.trustScore,
    mismatchCount: i.mismatchCount,
    openDiscrepancies: i._count.discrepancies,
    legacy: i.legacy,
    replacesInstrumentId: i.replacesInstrumentId,
    updatedAt: i.updatedAt.toISOString(),
  };
}
