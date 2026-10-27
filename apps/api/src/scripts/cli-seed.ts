/** `pnpm seed` entry point. */
import './seed-env.js';
import { scriptPrisma } from './db.js';
import { printCredentials, seedAll } from './seed.js';

const prisma = scriptPrisma();
try {
  if ((await prisma.user.count()) > 0) {
    console.log('Database already has data. Use `pnpm demo:reset` to wipe and reseed.');
  } else {
    await seedAll(prisma);
  }
  printCredentials();
} finally {
  await prisma.$disconnect();
}
