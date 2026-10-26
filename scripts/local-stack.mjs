#!/usr/bin/env node
// Dev-only local infrastructure for machines without Docker (see docs/DECISIONS.md D-011).
//
//   pnpm stack:up      start PostgreSQL 16, Redis and Mailpit in the background
//   pnpm stack:down    stop them
//   pnpm stack:status  show what is listening
//
// Ports and credentials match docker-compose.yml / .env.example, so the API cannot tell the difference.
// Everything lives in the git-ignored `.data/` folder. Docker remains the supported way to run the demo.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, '.data');
const BIN = path.join(DATA, 'bin');
const PIDS = path.join(DATA, 'pids.json');

const PG = {
  port: 5432,
  user: 'nidhisetu',
  password: 'nidhisetu_dev_password',
  databases: ['nidhisetu', 'nidhisetu_test'],
  dir: path.join(DATA, 'pg'),
  log: path.join(DATA, 'pg.log'),
};
const REDIS = {
  port: 6379,
  version: '8.8.3',
  url: 'https://github.com/redis-windows/redis-windows/releases/download/8.8.3/Redis-8.8.3-Windows-x64-msys2.zip',
};
const MAILPIT = {
  smtpPort: 1025,
  uiPort: 8025,
  url: 'https://github.com/axllent/mailpit/releases/download/v1.32.0/mailpit-windows-amd64.zip',
};

const isWindows = os.platform() === 'win32';
const log = (msg) => console.log(`[stack] ${msg}`);

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function readPids() {
  try {
    return JSON.parse(fs.readFileSync(PIDS, 'utf8'));
  } catch {
    return {};
  }
}

function writePids(pids) {
  fs.writeFileSync(PIDS, JSON.stringify(pids, null, 2));
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

/** Downloads and unzips a release archive once; returns the path of `exe` inside it. */
async function ensureBinary(name, url, exe) {
  const dir = path.join(BIN, name);
  const existing = fs.existsSync(dir) ? findFile(dir, exe) : null;
  if (existing) return existing;

  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'download.zip');
  log(`downloading ${name} from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // Windows 10+ ships bsdtar, which extracts zip archives.
  const tar = spawnSync('tar', ['-xf', zip, '-C', dir], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error(`could not extract ${zip}`);
  fs.rmSync(zip);
  const found = findFile(dir, exe);
  if (!found) throw new Error(`${exe} not found in ${url}`);
  return found;
}

function spawnDetached(file, args, logName) {
  const out = fs.openSync(path.join(DATA, logName), 'a');
  const child = spawn(file, args, {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function waitForPort(port, label, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not open port ${port} within ${timeoutMs / 1000}s`);
}

async function pgBinaries() {
  const pkg = {
    win32: '@embedded-postgres/windows-x64',
    linux: '@embedded-postgres/linux-x64',
    darwin:
      os.arch() === 'arm64' ? '@embedded-postgres/darwin-arm64' : '@embedded-postgres/darwin-x64',
  }[os.platform()];
  if (!pkg) throw new Error(`unsupported platform ${os.platform()}`);
  const mod = await import(pkg);
  return mod.default ?? mod;
}

async function startPostgres() {
  if (await portOpen(PG.port)) {
    log(`postgres: port ${PG.port} already in use, assuming it is running`);
    return;
  }
  const { initdb, pg_ctl } = await pgBinaries();
  if (!fs.existsSync(path.join(PG.dir, 'PG_VERSION'))) {
    log('postgres: initialising data directory');
    const pwfile = path.join(DATA, 'pg.pw');
    fs.writeFileSync(pwfile, PG.password);
    const res = spawnSync(
      initdb,
      [
        '-D',
        PG.dir,
        '-U',
        PG.user,
        '-A',
        'scram-sha-256',
        `--pwfile=${pwfile}`,
        '-E',
        'UTF8',
        '--locale=C',
      ],
      { stdio: 'inherit' },
    );
    fs.rmSync(pwfile);
    if (res.status !== 0) throw new Error('initdb failed');
  }
  log(`postgres: starting on port ${PG.port}`);
  // The server outlives this script, so it must not inherit our stdout/stderr: a caller that
  // waits for the pipe to close (CI, IDE terminals) would otherwise hang until postgres stops.
  const out = fs.openSync(path.join(DATA, 'pg_ctl.log'), 'a');
  const res = spawnSync(
    pg_ctl,
    [
      'start',
      '-D',
      PG.dir,
      '-l',
      PG.log,
      '-w',
      '-o',
      `-p ${PG.port} -c listen_addresses=localhost`,
    ],
    { stdio: ['ignore', out, out], windowsHide: true },
  );
  fs.closeSync(out);
  if (res.status !== 0) throw new Error(`pg_ctl start failed, see ${PG.log}`);
  await ensureDatabases();
}

async function ensureDatabases() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: '127.0.0.1',
    port: PG.port,
    user: PG.user,
    password: PG.password,
    database: 'postgres',
  });
  await client.connect();
  try {
    for (const db of PG.databases) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (!rowCount) {
        await client.query(`CREATE DATABASE "${db}"`);
        log(`postgres: created database ${db}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function startRedis(pids) {
  if (await portOpen(REDIS.port)) {
    log(`redis: port ${REDIS.port} already in use, assuming it is running`);
    return;
  }
  let exe = 'redis-server';
  if (isWindows) exe = await ensureBinary(`redis-${REDIS.version}`, REDIS.url, 'redis-server.exe');
  const dir = path.join(DATA, 'redis');
  fs.mkdirSync(dir, { recursive: true });
  log(`redis: starting on port ${REDIS.port}`);
  pids.redis = spawnDetached(
    exe,
    [
      '--port',
      String(REDIS.port),
      '--bind',
      '127.0.0.1',
      '--dir',
      dir,
      '--appendonly',
      'yes',
      '--maxmemory-policy',
      'noeviction',
    ],
    'redis.log',
  );
  await waitForPort(REDIS.port, 'redis');
}

async function startMailpit(pids) {
  if (await portOpen(MAILPIT.smtpPort)) {
    log(`mailpit: port ${MAILPIT.smtpPort} already in use, assuming it is running`);
    return;
  }
  let exe = 'mailpit';
  if (isWindows) exe = await ensureBinary('mailpit-1.32.0', MAILPIT.url, 'mailpit.exe');
  log(`mailpit: SMTP ${MAILPIT.smtpPort}, UI http://localhost:${MAILPIT.uiPort}`);
  pids.mailpit = spawnDetached(
    exe,
    ['--smtp', `127.0.0.1:${MAILPIT.smtpPort}`, '--listen', `127.0.0.1:${MAILPIT.uiPort}`],
    'mailpit.log',
  );
  await waitForPort(MAILPIT.smtpPort, 'mailpit');
}

async function up() {
  fs.mkdirSync(DATA, { recursive: true });
  const pids = readPids();
  await startPostgres();
  await startRedis(pids);
  await startMailpit(pids);
  writePids(pids);
  await status();
}

async function down() {
  const pids = readPids();
  for (const [name, pid] of Object.entries(pids)) {
    try {
      process.kill(pid);
      log(`${name}: stopped (pid ${pid})`);
    } catch {
      log(`${name}: not running`);
    }
  }
  writePids({});
  if (fs.existsSync(path.join(PG.dir, 'postmaster.pid'))) {
    const { pg_ctl } = await pgBinaries();
    spawnSync(pg_ctl, ['stop', '-D', PG.dir, '-m', 'fast'], { stdio: 'inherit' });
  }
}

async function status() {
  const rows = [
    ['postgres', PG.port],
    ['redis', REDIS.port],
    ['mailpit smtp', MAILPIT.smtpPort],
    ['mailpit ui', MAILPIT.uiPort],
  ];
  for (const [name, port] of rows) {
    log(`${name.padEnd(13)} :${port}  ${(await portOpen(port)) ? 'up' : 'down'}`);
  }
}

const commands = { up, down, status };
const cmd = process.argv[2] ?? 'status';
if (!commands[cmd]) {
  console.error(`usage: node scripts/local-stack.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
commands[cmd]().catch((err) => {
  console.error(`[stack] ${err.message}`);
  process.exit(1);
});
