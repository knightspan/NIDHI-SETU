import type { INestApplication } from '@nestjs/common';
import type { InstrumentDetail, Paged, InstrumentSummary } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { declaration, uniquePdf } from './fixtures.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('institution module: declare, upload, submit', () => {
  let app: INestApplication;
  let fx: Fixture;
  let prisma: PrismaService;
  let bankCode: string;
  let inst: Client;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    fx = await createFixture(app);
    bankCode = (await prisma.bank.findUniqueOrThrow({ where: { id: fx.bankId } })).code;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates a DRAFT with DECLARED assertions for every key field', async () => {
    const res = await inst.post('/api/instruments', declaration(bankCode)).expect(201);
    const { id, refNo } = res.body as { id: string; refNo: string };
    expect(refNo).toMatch(/^NS-\d{4}-\d{6}$/);
    const detail = (await inst.get(`/api/instruments/${id}`).expect(200)).body as InstrumentDetail;
    expect(detail.status).toBe('DRAFT');
    expect(detail.fields).toHaveLength(9);
    for (const f of detail.fields) expect(f.effectiveTrust).toBe('DECLARED');
    expect(detail.jointName).toBe(true);
    // 40 % provenance weight × 25 (all DECLARED) + half credit for three eyes not yet checked.
    expect(detail.trustScore).toBe(40);
    expect(detail.allowedActions).toEqual(
      expect.arrayContaining(['edit', 'submit', 'delete', 'upload']),
    );
  });

  it('validates the declaration', async () => {
    const bad = await inst.post(
      '/api/instruments',
      declaration(bankCode, { ifsc: 'BAD', maturityDate: '2020-01-01' }),
    );
    expect(bad.status).toBe(400);
    const paths = (bad.body as { issues: { path: string }[] }).issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['ifsc', 'maturityDate']));
  });

  it('uploads an encrypted document, versions it, and serves it through a signed link', async () => {
    const { id } = (await inst.post('/api/instruments', declaration(bankCode)).expect(201))
      .body as { id: string };
    const pdf = uniquePdf('scan-v1');
    const up = await inst
      .upload(`/api/instruments/${id}/documents`, 'file', pdf, 'scan.pdf', { type: 'FDR_SCAN' })
      .expect(201);
    const v1 = up.body as { id: string; version: number; mimeType: string };
    expect(v1).toMatchObject({ version: 1, mimeType: 'application/pdf' });
    const v2 = (
      await inst
        .upload(`/api/instruments/${id}/documents`, 'file', uniquePdf('scan-v2'), 'scan2.pdf', {
          type: 'FDR_SCAN',
        })
        .expect(201)
    ).body as { version: number };
    expect(v2.version).toBe(2);

    // Stored ciphertext never contains the plaintext.
    const row = await prisma.document.findUniqueOrThrow({ where: { id: v1.id } });
    expect(row.iv).toBeTruthy();
    expect(row.authTag).toBeTruthy();

    const { url } = (await inst.get(`/api/documents/${v1.id}/url`).expect(200)).body as {
      url: string;
    };
    const anon = await Client.anonymous(app);
    const dl = await anon.agent.get(url).buffer(true).expect(200);
    expect(Buffer.compare(dl.body as Buffer, pdf)).toBe(0);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    const logged = await prisma.auditEvent.count({
      where: { action: 'document.downloaded', entityId: v1.id },
    });
    expect(logged).toBe(1);

    await anon.agent.get('/api/documents/download?token=forged').expect(403);
  });

  it('rejects files whose bytes are not PDF/PNG/JPEG, whatever the extension', async () => {
    const { id } = (await inst.post('/api/instruments', declaration(bankCode)).expect(201))
      .body as { id: string };
    const res = await inst.upload(
      `/api/instruments/${id}/documents`,
      'file',
      Buffer.from('<script>x</script>'),
      'evil.pdf',
      {
        type: 'FDR_SCAN',
      },
    );
    expect(res.status).toBe(400);
  });

  it('submits, then refuses edits and illegal actions with 409', async () => {
    const { id } = (await inst.post('/api/instruments', declaration(bankCode)).expect(201))
      .body as { id: string };
    await inst.post(`/api/instruments/${id}/submit`).expect(200);
    const d = (await inst.get(`/api/instruments/${id}`)).body as InstrumentDetail;
    expect(d.status).toBe('SUBMITTED');
    expect(d.submittedAt).not.toBeNull();
    expect(d.transitions.map((t) => t.to)).toEqual(['DRAFT', 'SUBMITTED']);
    await inst.patch(`/api/instruments/${id}`, declaration(bankCode)).expect(409);
    await inst.post(`/api/instruments/${id}/submit`).expect(409);
    await inst.delete(`/api/instruments/${id}`).expect(409);
  });

  it('records a new DECLARED assertion only for fields that changed', async () => {
    const decl = declaration(bankCode);
    const { id } = (await inst.post('/api/instruments', decl).expect(201)).body as { id: string };
    await inst.patch(`/api/instruments/${id}`, { ...decl, amount: 2_000_000 }).expect(200);
    const d = (await inst.get(`/api/instruments/${id}`)).body as InstrumentDetail;
    expect(d.fields.find((f) => f.field === 'amount')!.history).toHaveLength(2);
    expect(d.fields.find((f) => f.field === 'ifsc')!.history).toHaveLength(1);
    expect(d.amount).toBe('2000000.00');
  });

  it('deletes drafts', async () => {
    const { id } = (await inst.post('/api/instruments', declaration(bankCode)).expect(201))
      .body as { id: string };
    await inst.delete(`/api/instruments/${id}`).expect(200);
    await inst.get(`/api/instruments/${id}`).expect(404);
  });

  describe('scoping', () => {
    let id: string;
    beforeAll(async () => {
      id = (
        (await inst.post('/api/instruments', declaration(bankCode)).expect(201)).body as {
          id: string;
        }
      ).id;
    });

    it("hides other institutions' instruments (404, not 403)", async () => {
      const other = await Client.login(app, fx.others.institutionUser);
      await other.get(`/api/instruments/${id}`).expect(404);
      const list = (await other.get('/api/instruments').expect(200))
        .body as Paged<InstrumentSummary>;
      expect(list.items.find((i) => i.id === id)).toBeUndefined();
    });

    it('shows the instrument to the regional officer of its region only', async () => {
      const ro = await Client.login(app, fx.users.RO_OFFICER);
      await ro.get(`/api/instruments/${id}`).expect(200);
      const otherRo = await Client.login(app, fx.others.roOfficer);
      await otherRo.get(`/api/instruments/${id}`).expect(404);
      const list = (
        await otherRo.get(`/api/instruments?institutionId=${fx.institutionId}`).expect(200)
      ).body as Paged<InstrumentSummary>;
      expect(list.total).toBe(0);
    });

    it('lets national roles read but not write', async () => {
      const bureau = await Client.login(app, fx.users.BUREAU_OFFICER);
      await bureau.get(`/api/instruments/${id}`).expect(200);
      await bureau.post('/api/instruments', declaration(bankCode)).expect(403);
    });

    it('gives the admin and unrelated bank officers nothing', async () => {
      const admin = await Client.login(app, fx.users.SYS_ADMIN);
      await admin.get('/api/instruments').expect(403);
      await admin.get(`/api/instruments/${id}`).expect(403);
      const bank = await Client.login(app, fx.users.BANK_OFFICER);
      await bank.get(`/api/instruments/${id}`).expect(404);
    });

    it('searches by FDR number, reference and institution', async () => {
      const d = (await inst.get(`/api/instruments/${id}`)).body as InstrumentDetail;
      for (const q of [d.fdrNumber!, d.refNo, fx.tag]) {
        const r = (await inst.get(`/api/instruments?q=${encodeURIComponent(q)}`))
          .body as Paged<InstrumentSummary>;
        expect(r.items.map((i) => i.id)).toContain(id);
      }
    });
  });
});
