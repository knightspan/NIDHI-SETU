import { pgAdapter } from '../prisma/prisma.service.js';
import { getConfig } from '../config/config.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** Prisma client for CLI scripts (seed, demo reset, load test, tamper demo). */
export function scriptPrisma(url = getConfig().DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: pgAdapter(url) });
}
