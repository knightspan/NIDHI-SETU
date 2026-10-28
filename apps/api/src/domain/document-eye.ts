import { IFSC_REGEX } from '@nidhisetu/shared';
import type { MaturityCheck } from './maturity-math.js';

/**
 * TRINETRA document eye (b) and (c), and the combined result. Pure functions: the service loads the
 * IFSC master row and duplicate candidates and passes them in.
 */

export type CheckResult = 'PASS' | 'FAIL' | 'NOT_AVAILABLE';

export interface IfscMasterRow {
  ifsc: string;
  bankCode: string;
  branch: string;
  city?: string | null;
}

export interface IfscCheck {
  result: CheckResult;
  note: string;
  masterBranch: string | null;
}

/** Folds case, punctuation and the word "branch" so "MG Road Branch" equals "M.G. ROAD". */
export function normaliseBranch(s: string): string {
  return s
    .toUpperCase()
    .replace(/\bBRANCH\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * (b) Format, presence in the local IFSC master, bank prefix and branch name. When the master has
 * no rows for this bank at all (not loaded yet), the lookup is NOT_AVAILABLE rather than a FAIL.
 */
export function checkIfsc(i: {
  ifsc: string | null;
  bankCode: string | null;
  branch: string | null;
  master: IfscMasterRow | null;
  masterHasBank: boolean;
}): IfscCheck {
  if (!i.ifsc) return { result: 'NOT_AVAILABLE', note: 'No IFSC on record', masterBranch: null };
  if (!IFSC_REGEX.test(i.ifsc))
    return {
      result: 'FAIL',
      note: `${i.ifsc} is not a valid IFSC (AAAA0XXXXXX)`,
      masterBranch: null,
    };
  if (i.bankCode && !i.ifsc.startsWith(i.bankCode))
    return {
      result: 'FAIL',
      note: `${i.ifsc} does not belong to bank ${i.bankCode}`,
      masterBranch: null,
    };
  if (!i.master) {
    return i.masterHasBank
      ? { result: 'FAIL', note: `${i.ifsc} is not in the IFSC master`, masterBranch: null }
      : {
          result: 'NOT_AVAILABLE',
          note: 'IFSC master not loaded for this bank',
          masterBranch: null,
        };
  }
  if (i.branch && normaliseBranch(i.branch) !== normaliseBranch(i.master.branch)) {
    return {
      result: 'FAIL',
      note: `The FDR names branch "${i.branch}" but ${i.ifsc} is "${i.master.branch}"`,
      masterBranch: i.master.branch,
    };
  }
  return { result: 'PASS', note: `${i.ifsc} is ${i.master.branch}`, masterBranch: i.master.branch };
}

export interface DuplicateCheck {
  result: CheckResult;
  note: string;
  sameFdr: { refNo: string; institutionName: string }[];
  sameDocument: { refNo: string; institutionName: string }[];
}

/** (c) The same (bank, FDR number) or the same scan hash on another instrument. */
export function checkDuplicates(i: {
  hasFdrKey: boolean;
  hasScan: boolean;
  sameFdr: { refNo: string; institutionName: string }[];
  sameDocument: { refNo: string; institutionName: string }[];
}): DuplicateCheck {
  if (!i.hasFdrKey && !i.hasScan)
    return {
      result: 'NOT_AVAILABLE',
      note: 'No FDR number or scan yet',
      sameFdr: [],
      sameDocument: [],
    };
  const parts: string[] = [];
  if (i.sameFdr.length)
    parts.push(
      `same FDR number as ${i.sameFdr.map((d) => `${d.refNo} (${d.institutionName})`).join(', ')}`,
    );
  if (i.sameDocument.length)
    parts.push(
      `same scan as ${i.sameDocument.map((d) => `${d.refNo} (${d.institutionName})`).join(', ')}`,
    );
  return parts.length
    ? {
        result: 'FAIL',
        note: `Recycled: ${parts.join('; ')}`,
        sameFdr: i.sameFdr,
        sameDocument: i.sameDocument,
      }
    : {
        result: 'PASS',
        note: 'No other instrument uses this FDR or scan',
        sameFdr: [],
        sameDocument: [],
      };
}

export interface DocumentEye {
  result: CheckResult;
  maturityMath: MaturityCheck;
  ifsc: IfscCheck;
  duplicate: DuplicateCheck;
}

/** Any FAIL fails the eye; all NOT_AVAILABLE is NOT_AVAILABLE; otherwise PASS. */
export function combineDocumentEye(
  maturityMath: MaturityCheck,
  ifsc: IfscCheck,
  duplicate: DuplicateCheck,
): DocumentEye {
  const results = [maturityMath.result, ifsc.result, duplicate.result];
  const result: CheckResult = results.includes('FAIL')
    ? 'FAIL'
    : results.every((r) => r === 'NOT_AVAILABLE')
      ? 'NOT_AVAILABLE'
      : 'PASS';
  return { result, maturityMath, ifsc, duplicate };
}
