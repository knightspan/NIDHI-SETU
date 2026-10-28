import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEMO_MODE: bool(true),
  /**
   * Require an authenticator for every role, institutions included. Unset: on outside demo mode
   * (demo institution accounts sign in with a password only, to keep the walkthrough short).
   */
  MFA_REQUIRED_ALL_ROLES: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['true', 'false']).optional(),
  ),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  API_PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
  MFA_ENCRYPTION_KEY: base64Key,
  /** Signs audit-chain anchors. Keep it outside the database (secret store); required in production. */
  AUDIT_ANCHOR_KEY: z.string().min(32).optional(),
  DOCUMENT_ENCRYPTION_KEY: base64Key,
  DOCUMENT_MAX_MB: z.coerce.number().positive().default(10),
  DOCUMENT_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  STORAGE_DRIVER: z.enum(['s3', 'fs', 'db']).default('fs'),
  STORAGE_FS_ROOT: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().default('nidhisetu-documents'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_FROM: z.string().default('NidhiSetu <no-reply@nidhisetu.local>'),
  EMAIL_ENABLED: bool(true),
  SMS_ADAPTER: z.enum(['stub']).default('stub'),
  // desk = every bank via the manual desk; mock-api = simulated API for every bank;
  // auto = simulated API for banks flagged apiEnabled in the master, desk for the rest.
  BANK_ADAPTER: z.enum(['desk', 'mock-api', 'auto']).default('auto'),
  MOCK_BANK_API_LATENCY_MS: z.coerce.number().int().nonnegative().default(800),
  MOCK_BANK_API_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  OCR_URL: z.string().default('http://localhost:8000'),
  QUEUE_ENABLED: bool(true),
  RETENTION_YEARS_CLOSED_RECORDS: z.coerce.number().int().positive().default(8),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

let cached: AppConfig | undefined;

/** Repo root, so the single root .env is found from src/ and dist/ alike. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export function loadConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.AUDIT_ANCHOR_KEY) {
    throw new Error(
      'Invalid environment configuration:\n  AUDIT_ANCHOR_KEY: required in production',
    );
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DEMO_MODE) {
    // Allowed (a hosted demo), but loud.
    console.warn('[config] DEMO_MODE=true in production: the demo clock is enabled.');
  }
  return parsed.data;
}

/** Development-only fallback; production refuses to start without AUDIT_ANCHOR_KEY. */
export const DEV_AUDIT_ANCHOR_KEY = 'dev-only-audit-anchor-key-change-me-0123456789';

export function auditAnchorKey(cfg: Pick<AppConfig, 'AUDIT_ANCHOR_KEY'>): string {
  return cfg.AUDIT_ANCHOR_KEY ?? DEV_AUDIT_ANCHOR_KEY;
}

/** Whether `role` must sign in with a second factor under this configuration. */
export function mfaRequiredFor(
  role: string,
  cfg: Pick<AppConfig, 'MFA_REQUIRED_ALL_ROLES' | 'DEMO_MODE'>,
  mandatory: readonly string[],
): boolean {
  if (mandatory.includes(role)) return true;
  return cfg.MFA_REQUIRED_ALL_ROLES ? cfg.MFA_REQUIRED_ALL_ROLES === 'true' : !cfg.DEMO_MODE;
}

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test helper. */
export function resetConfigCache(): void {
  cached = undefined;
}
