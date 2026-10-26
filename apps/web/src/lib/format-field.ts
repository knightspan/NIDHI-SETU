import type { FieldKey } from '@nidhisetu/shared';
import { formatDate, formatInr } from './utils';

/** Human rendering of a normalised field value. */
export function formatFieldValue(
  field: FieldKey,
  value: string | null | undefined,
  opts: { bankName?: (code: string) => string | undefined; yes: string; no: string },
): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field) {
    case 'amount':
      return formatInr(value);
    case 'issueDate':
    case 'maturityDate':
      return formatDate(value);
    case 'lienMarked':
    case 'autoRenewal':
      return value === 'true' ? opts.yes : opts.no;
    case 'bankCode': {
      const name = opts.bankName?.(value);
      return name ? `${name} (${value})` : value;
    }
    default:
      return value;
  }
}
