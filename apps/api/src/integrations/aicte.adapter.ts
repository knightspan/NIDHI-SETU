import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** What the AICTE approval portal knows about an institution (the source of truth for its master). */
export interface AicteInstitutionRecord {
  aicteId: string;
  name: string;
  trustName: string;
  state: string;
  regionCode: string;
  yearEstablished: number;
  programmes: string[];
  approvalStatus: 'APPROVED' | 'PENDING' | 'WITHDRAWN';
}

/**
 * Integration point for the AICTE approval portal (docs/INTEGRATION.md §2). A real implementation
 * calls the portal's API (or reads a nightly extract) with credentials from the secret store.
 */
export interface AicteApprovalAdapter {
  fetchInstitution(aicteId: string): Promise<AicteInstitutionRecord | null>;
}

export const AICTE_APPROVAL_ADAPTER = Symbol('AICTE_APPROVAL_ADAPTER');

/**
 * Demo stand-in for the portal. It mirrors the local (fictional) institution master and, to show
 * drift detection, reports one extra programme for institutions whose AICTE ID ends in 7 — as if
 * the institution had been approved for a new programme that NidhiSetu has not picked up yet.
 */
@Injectable()
export class MockAicteApprovalAdapter implements AicteApprovalAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async fetchInstitution(aicteId: string): Promise<AicteInstitutionRecord | null> {
    const i = await this.prisma.institution.findUnique({
      where: { aicteId },
      include: { region: true },
    });
    if (!i) return null;
    const drift = aicteId.endsWith('7') && !i.programmes.includes('MCA');
    return {
      aicteId: i.aicteId,
      name: i.name,
      trustName: i.trustName,
      state: i.state,
      regionCode: i.region.code,
      yearEstablished: i.yearEstablished,
      programmes: drift ? [...i.programmes, 'MCA'] : [...i.programmes],
      approvalStatus: 'APPROVED',
    };
  }
}

export interface MasterDifference {
  field: keyof AicteInstitutionRecord;
  portal: string;
  local: string;
}

/** Fields where the portal and the local master disagree (programmes compared as sets). */
export function compareMaster(
  portal: AicteInstitutionRecord,
  local: Omit<AicteInstitutionRecord, 'approvalStatus'>,
): MasterDifference[] {
  const out: MasterDifference[] = [];
  const scalar = ['name', 'trustName', 'state', 'regionCode', 'yearEstablished'] as const;
  for (const f of scalar) {
    if (String(portal[f]) !== String(local[f]))
      out.push({ field: f, portal: String(portal[f]), local: String(local[f]) });
  }
  const p = [...portal.programmes].sort().join(', ');
  const l = [...local.programmes].sort().join(', ');
  if (p !== l) out.push({ field: 'programmes', portal: p, local: l });
  return out;
}
