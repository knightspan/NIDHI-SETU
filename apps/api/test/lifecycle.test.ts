import type { INestApplication } from '@nestjs/common';
import { DEFAULT_RULES } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClockService } from '../src/clock/clock.service.js';
import { getConfig } from '../src/config/config.js';
import { addDays, istDateIso, toIso } from '../src/domain/dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { detail, toActive } from './flows.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('lifecycle job, demo clock, reminders, escalation, rules', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;
  let bankCode: string;
  let inst: Client;
  let ro: Client;
  let bank: Client;
  let admin: Client;
  let id: string;
  const realToday = new Date(`${istDateIso(new Date())}T00:00:00Z`);
  const maturity = addDays(realToday, 100);
  const issue = new Date(
    Date.UTC(maturity.getUTCFullYear() - 5, maturity.getUTCMonth(), maturity.getUTCDate()),
  );

  const setClock = (today: string) => admin.post('/api/admin/clock', { today }).expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = await createFixture(app);
    bankCode = (await prisma.bank.findUniqueOrThrow({ where: { id: fx.bankId } })).code;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
    ro = await Client.login(app, fx.users.RO_OFFICER);
    bank = await Client.login(app, fx.users.BANK_OFFICER);
    admin = await Client.login(app, fx.users.SYS_ADMIN);
    await admin.post('/api/admin/clock/reset').expect(200);
    id = await toActive(inst, ro, bank, bankCode, {
      issueDate: toIso(issue),
      maturityDate: toIso(maturity),
    });
  });
  afterAll(async () => {
    await admin.post('/api/admin/clock/reset');
    await app.close();
  });

  it('computes validity at activation', async () => {
    expect((await detail(ro, id)).validityStatus).toBe('VALID');
  });

  it('moves an instrument to EXPIRING_SOON when the demo clock advances (PS: approaching maturity)', async () => {
    const res = await setClock(toIso(addDays(maturity, -90)));
    expect(
      (res.body as { lifecycle: { remindersCreated: number } }).lifecycle.remindersCreated,
    ).toBeGreaterThanOrEqual(1);
    const d = await detail(ro, id);
    expect(d.validityStatus).toBe('EXPIRING_SOON');
    const reminders = await prisma.reminder.findMany({ where: { instrumentId: id } });
    expect(reminders.map((r) => r.offsetDays)).toEqual([90]);
    const notes = (await inst.get('/api/notifications?unread=true').expect(200)).body as {
      items: { kind: string; title: string }[];
    };
    expect(notes.items.some((n) => n.kind === 'REMINDER' && n.title.includes(d.refNo))).toBe(true);
  });

  it('sends one reminder per offset, however often the job runs', async () => {
    await admin.post('/api/admin/jobs/lifecycle').expect(200);
    await admin.post('/api/admin/jobs/lifecycle').expect(200);
    expect(await prisma.reminder.count({ where: { instrumentId: id } })).toBe(1);
    await setClock(toIso(addDays(maturity, -29)));
    const offsets = (await prisma.reminder.findMany({ where: { instrumentId: id } }))
      .map((r) => r.offsetDays)
      .sort((a, b) => a - b);
    expect(offsets).toEqual([30, 60, 90]);
  });

  it('marks MATURED during grace, then OVERDUE_RENEWAL with an escalation', async () => {
    await setClock(toIso(addDays(maturity, 5)));
    expect((await detail(ro, id)).validityStatus).toBe('MATURED');
    await setClock(toIso(addDays(maturity, 20)));
    expect((await detail(ro, id)).validityStatus).toBe('OVERDUE_RENEWAL');
    const esc = await prisma.escalation.findMany({
      where: { entityId: id, entityType: 'OVERDUE_RENEWAL' },
    });
    expect(esc.map((e) => [e.level, e.toRole])).toEqual([[1, 'RO_OFFICER']]);
    const list = (await ro.get('/api/escalations').expect(200)).body as {
      items: { entityId: string }[];
    };
    expect(list.items.some((e) => e.entityId === id)).toBe(true);
    const other = (
      await (await Client.login(app, fx.others.roOfficer)).get('/api/escalations').expect(200)
    ).body as {
      items: { entityId: string }[];
    };
    expect(other.items.some((e) => e.entityId === id)).toBe(false);
  });

  it('resolves escalations once the condition clears', async () => {
    await admin.post('/api/admin/clock/reset').expect(200);
    const esc = await prisma.escalation.findFirstOrThrow({
      where: { entityId: id, entityType: 'OVERDUE_RENEWAL' },
    });
    expect(esc.resolvedAt).not.toBeNull();
    expect((await detail(ro, id)).validityStatus).toBe('VALID');
  });

  it('lets only the admin move the clock or run jobs', async () => {
    await ro.post('/api/admin/clock', { advanceDays: 10 }).expect(403);
    await ro.post('/api/admin/jobs/lifecycle').expect(403);
    await (await Client.login(app, fx.users.AUDITOR)).get('/api/admin/clock').expect(403);
    const clock = (await admin.get('/api/admin/clock').expect(200)).body as {
      demoMode: boolean;
      offsetDays: number;
    };
    expect(clock).toMatchObject({ demoMode: true, offsetDays: 0 });
  });

  it('refuses to move the clock when DEMO_MODE=false', async () => {
    const strict = new ClockService(prisma, { ...getConfig(), DEMO_MODE: false });
    await expect(strict.setToday('2030-01-01', null)).rejects.toThrow(/disabled/);
    await strict.sync();
    expect(strict.offset).toBe(0);
  });

  it('publishes versioned rules that the next run uses, with audit', async () => {
    await (
      await Client.login(app, fx.users.RO_OFFICER)
    )
      .post('/api/rules/reminders.maturity', {})
      .expect(403);
    await admin
      .post('/api/rules/reminders.maturity', {
        config: { offsetsDays: [], recipients: [] },
        effectiveFrom: istDateIso(new Date()),
        source: 'test',
      })
      .expect(400);
    const res = await admin
      .post('/api/rules/reminders.maturity', {
        config: { ...DEFAULT_RULES['reminders.maturity'], offsetsDays: [120, 90, 60, 30, 7] },
        effectiveFrom: istDateIso(new Date()),
        source: 'Test circular (fictional)',
        note: 'Earlier first reminder',
      })
      .expect(201);
    expect((res.body as { version: number }).version).toBe(2);
    const rules = (await ro.get('/api/rules').expect(200)).body as {
      code: string;
      current: { version: number };
    }[];
    expect(rules.find((r) => r.code === 'reminders.maturity')!.current.version).toBe(2);
    expect(await prisma.auditEvent.count({ where: { action: 'rule.published' } })).toBeGreaterThan(
      0,
    );
    // Restore the default for other test files.
    await admin.post('/api/rules/reminders.maturity', {
      config: DEFAULT_RULES['reminders.maturity'],
      effectiveFrom: istDateIso(new Date()),
      source: 'restore',
    });
  });

  it('serves the user their notifications and marks them read', async () => {
    const before = (await inst.get('/api/notifications/unread-count').expect(200)).body as {
      unread: number;
    };
    expect(before.unread).toBeGreaterThan(0);
    await inst.post('/api/notifications/read-all').expect(200);
    expect(
      ((await inst.get('/api/notifications/unread-count')).body as { unread: number }).unread,
    ).toBe(0);
  });

  it('builds a daily digest for officers', async () => {
    // Give the regional officer something waiting in the queue.
    const { submitInstrument } = await import('./flows.js');
    await submitInstrument(inst, bankCode);
    const r = (await admin.post('/api/admin/jobs/digest').expect(200)).body as { sent: number };
    expect(r.sent).toBeGreaterThan(0);
  });
});
