import { z } from 'zod';
import type { FieldKey } from './enums.js';

/** IFSC: 4 letters (bank), a zero, 6 alphanumerics (branch). */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const isoDate = z
  .string()
  .regex(ISO_DATE_REGEX, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date');

/**
 * Normalises a field value to the canonical string stored in FieldAssertion.value, so that
 * " 1,00,000.00 " and "100000" compare equal and names compare case-insensitively.
 */
/** Primitive-safe string conversion (objects become JSON, never "[object Object]"). */
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v.toString();
  return JSON.stringify(v) ?? '';
}

export function normalizeFieldValue(field: FieldKey, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  switch (field) {
    case 'amount': {
      const n = typeof raw === 'number' ? raw : Number(str(raw).replace(/[₹,\s]/g, ''));
      return Number.isFinite(n) ? n.toFixed(2) : str(raw).trim();
    }
    case 'issueDate':
    case 'maturityDate': {
      if (raw instanceof Date) return raw.toISOString().slice(0, 10);
      return str(raw).trim().slice(0, 10);
    }
    case 'lienMarked':
    case 'autoRenewal':
      return raw === true || str(raw).toLowerCase() === 'true' ? 'true' : 'false';
    case 'depositorNames': {
      const list: unknown[] = Array.isArray(raw) ? raw : str(raw).split(/[;|]/);
      return list
        .map((n) => str(n).trim().replace(/\s+/g, ' ').toUpperCase())
        .filter(Boolean)
        .sort()
        .join('; ');
    }
    case 'ifsc':
    case 'fdrNumber':
    case 'bankCode':
      return str(raw).trim().replace(/\s+/g, '').toUpperCase();
  }
}

/** Human labels (English). Hindi labels live in the web app's message files. */
export const FIELD_LABELS: Record<FieldKey, string> = {
  fdrNumber: 'FDR number',
  bankCode: 'Bank',
  ifsc: 'Branch IFSC',
  amount: 'Amount (₹)',
  issueDate: 'Issue date',
  maturityDate: 'Maturity date',
  depositorNames: 'Beneficiary / depositor names',
  lienMarked: 'Lien marked in favour of AICTE',
  autoRenewal: 'Auto-renewal',
};

/** Name that marks a joint deposit with AICTE in depositorNames. */
export const AICTE_BENEFICIARY = 'AICTE';
