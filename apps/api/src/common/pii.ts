import { ConsoleLogger } from '@nestjs/common';

/**
 * PII masking for logs and audit payloads (DPDP Act 2023: data minimisation). Logs never need a
 * full email address, phone number, account number or download token to be useful.
 */

/** a***@example.com */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/** ••••••••78 */
export function maskPhone(phone: string): string {
  return phone.replace(/\d(?=\d{2})/g, '•');
}

const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
// Indian mobile numbers, optionally with +91 / 0 prefix and separators.
const PHONE = /(?<![\w/-])(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\w/-])/g;
// Long digit runs (bank account / Aadhaar-like numbers): keep the last 4.
const LONG_DIGITS = /(?<![\w/.-])\d{9,18}(?![\w/.-])/g;
// Bearer tokens, signed-URL tokens, JWTs.
const TOKEN = /\b(token=|Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** Masks emails, phone numbers, long account-like numbers and tokens in free text. */
export function maskPii(text: string): string {
  return text
    .replace(TOKEN, '$1[redacted]')
    .replace(JWT, '[jwt]')
    .replace(EMAIL, (_m, first: string, domain: string) => `${first}***@${domain}`)
    .replace(PHONE, (m) => maskPhone(m))
    .replace(LONG_DIGITS, (m) => `${'•'.repeat(m.length - 4)}${m.slice(-4)}`);
}

function maskArg(a: unknown): unknown {
  if (typeof a === 'string') return maskPii(a);
  if (a instanceof Error) {
    const e = new Error(maskPii(a.message));
    e.name = a.name;
    e.stack = a.stack ? maskPii(a.stack) : undefined;
    return e;
  }
  return a;
}

/** Nest logger that masks PII in every message before it is written. */
export class MaskingLogger extends ConsoleLogger {
  override log(message: unknown, ...rest: unknown[]) {
    super.log(maskArg(message), ...rest.map(maskArg));
  }
  override error(message: unknown, ...rest: unknown[]) {
    super.error(maskArg(message), ...rest.map(maskArg));
  }
  override warn(message: unknown, ...rest: unknown[]) {
    super.warn(maskArg(message), ...rest.map(maskArg));
  }
  override debug(message: unknown, ...rest: unknown[]) {
    super.debug(maskArg(message), ...rest.map(maskArg));
  }
  override verbose(message: unknown, ...rest: unknown[]) {
    super.verbose(maskArg(message), ...rest.map(maskArg));
  }
  override fatal(message: unknown, ...rest: unknown[]) {
    super.fatal(maskArg(message), ...rest.map(maskArg));
  }
}
