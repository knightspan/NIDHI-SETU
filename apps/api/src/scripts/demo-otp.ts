/** `pnpm demo:otp [email]` — prints current TOTP codes for the demo accounts (demo convenience only). */
import { generate } from 'otplib';
import { DEMO_USERS, demoMfaSecret } from './demo-users.js';

const filter = process.argv[2];
const users = DEMO_USERS.filter(
  (u) => u.role !== 'INSTITUTION_USER' && (!filter || u.email.startsWith(filter)),
);
if (users.length === 0) {
  console.error(`No demo officer account matches "${filter}".`);
  process.exit(1);
}
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
for (const u of users) {
  console.log(`${(await generate({ secret: demoMfaSecret(u.email) })).padEnd(8)} ${u.email}`);
}
console.log(`(valid for ${left}s)`);
