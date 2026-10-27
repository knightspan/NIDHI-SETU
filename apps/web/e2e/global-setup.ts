import { execSync } from 'node:child_process';
import path from 'node:path';

/** Resets the demo database so every run starts from the same seeded portfolio. */
export default async function globalSetup(): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const health = await fetch(`${base}/api/health`).catch(() => null);
  if (!health?.ok)
    throw new Error(`The stack is not reachable at ${base} (start web + API first).`);
  if (process.env.E2E_RESET === '0') return;
  execSync('pnpm --filter @nidhisetu/api demo:reset', {
    cwd: path.resolve(import.meta.dirname, '../../..'),
    stdio: 'ignore',
  });
}
