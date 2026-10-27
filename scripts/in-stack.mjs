#!/usr/bin/env node
/**
 * Runs an API script (seed, demo:reset, tamper) where the API runs:
 *  - inside the `api` container when the Docker Compose stack is up (so documents go to the
 *    stack's object store and the stack's database is used);
 *  - otherwise locally through the workspace script.
 * Usage: node scripts/in-stack.mjs <seed|demo:reset|tamper>
 */
import { execSync, spawnSync } from 'node:child_process';

const SCRIPTS = { seed: 'cli-seed.js', 'demo:reset': 'cli-demo-reset.js', tamper: 'cli-tamper.js' };
const name = process.argv[2];
if (!SCRIPTS[name]) {
  console.error(`Usage: in-stack.mjs <${Object.keys(SCRIPTS).join('|')}>`);
  process.exit(2);
}

let inDocker = false;
try {
  inDocker =
    execSync('docker compose ps --status running -q api', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim().length > 0;
} catch {
  inDocker = false;
}

const r = inDocker
  ? spawnSync('docker', ['compose', 'exec', '-T', 'api', 'node', `dist/scripts/${SCRIPTS[name]}`], {
      stdio: 'inherit',
    })
  : spawnSync('pnpm', ['--filter', '@nidhisetu/api', name], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
