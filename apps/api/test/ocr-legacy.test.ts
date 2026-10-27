import type { INestApplication } from '@nestjs/common';
import type { LegacyBatchView, OcrPreview, ReconciliationReport } from '@nidhisetu/shared';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { declaration, uniquePdf } from './fixtures.js';
import { ocrPdf } from './fake-ocr.js';
import { detail } from './flows.js';
import { Client, createFixture, createTestApp, type Fixture } from './helpers.js';

describe('OCR extraction and legacy digitisation', () => {
  let app: INestApplication;
  let fx: Fixture;
  let bankCode: string;
  let bankName: string;
  let inst: Client;
  let ro: Client;
  let otherRo: Client;
  let emptyInstitutionId: string;

  const scanFor = (d: ReturnType<typeof declaration>, overrides: { amount?: number } = {}) =>
    ocrPdf(
      {
        fdr_number: d.fdrNumber,
        bank_name: bankName,
        ifsc: d.ifsc,
        amount: overrides.amount ?? Number(d.amount),
        issue_date: d.issueDate,
        maturity_date: d.maturityDate,
        depositor_names: d.depositorNames,
      },
      { amount: 0.6 },
    );

  beforeAll(async () => {
    app = await createTestApp();
    fx = await createFixture(app);
    const bank = await app.get(PrismaService).bank.findUniqueOrThrow({ where: { id: fx.bankId } });
    bankCode = bank.code;
    bankName = bank.name;
    inst = await Client.login(app, fx.users.INSTITUTION_USER);
    ro = await Client.login(app, fx.users.RO_OFFICER);
    otherRo = await Client.login(app, fx.others.roOfficer);
    // An institution in the region that should hold a deposit but has none on record.
    emptyInstitutionId = (
      await app.get(PrismaService).institution.create({
        data: {
          aicteId: `T-${fx.tag}-EMPTY`,
          name: `Empty Institute ${fx.tag}`,
          trustName: 'Empty Trust',
          regionId: fx.regionId,
          state: 'Test State',
          yearEstablished: 2024,
          programmes: ['UG_ENGINEERING'],
          contactEmail: `empty-${fx.tag}@example.test`,
          contactPhone: '0000000000',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('scan upload on an instrument', () => {
    it('records OCR_EXTRACTED assertions linked to the scan, flagging low confidence', async () => {
      const d = declaration(bankCode);
      const { id } = (await inst.post('/api/instruments', d).expect(201)).body as { id: string };
      const up = await inst
        .upload(`/api/instruments/${id}/documents`, 'file', scanFor(d), 'scan.pdf', {
          type: 'FDR_SCAN',
        })
        .expect(201);
      const ocr = (up.body as { id: string; ocr: OcrPreview | null }).ocr;
      expect(ocr?.fields.bankCode).toBe(bankCode);
      expect(ocr?.lowConfidence).toEqual(['amount']);

      const det = await detail(inst, id);
      const amount = det.fields.find((f) => f.field === 'amount')!;
      const ocrRow = amount.history.find((h) => h.trust === 'OCR_EXTRACTED')!;
      expect(ocrRow.confidence).toBeCloseTo(0.6);
      expect(ocrRow.evidenceDocumentId).toBe((up.body as { id: string }).id);
      expect(det.fields.every((f) => !f.mismatch)).toBe(true);
    });

    it('a scan that disagrees with the declaration raises a field mismatch', async () => {
      const d = declaration(bankCode);
      const { id } = (await inst.post('/api/instruments', d).expect(201)).body as { id: string };
      await inst
        .upload(
          `/api/instruments/${id}/documents`,
          'file',
          scanFor(d, { amount: 150_000 }),
          'scan.pdf',
          { type: 'FDR_SCAN' },
        )
        .expect(201);
      await inst.post(`/api/instruments/${id}/submit`).expect(200);
      const det = await detail(ro, id);
      expect(det.fields.find((f) => f.field === 'amount')!.mismatch).toBe(true);
      expect(
        det.discrepancies.some((x) => x.ruleCode === 'FIELD_MISMATCH' && x.status === 'OPEN'),
      ).toBe(true);
    });

    it('an unreadable scan is accepted without OCR', async () => {
      const d = declaration(bankCode);
      const { id } = (await inst.post('/api/instruments', d).expect(201)).body as { id: string };
      const up = await inst
        .upload(`/api/instruments/${id}/documents`, 'file', uniquePdf(id), 'scan.pdf', {
          type: 'FDR_SCAN',
        })
        .expect(201);
      expect((up.body as { ocr: unknown }).ocr).toBeNull();
    });

    it('pre-fill preview returns fields without storing anything', async () => {
      const d = declaration(bankCode);
      const res = await inst.upload('/api/ocr/preview', 'file', scanFor(d), 'scan.pdf').expect(200);
      const body = res.body as { preview: OcrPreview | null; error: string | null };
      expect(body.preview?.fields.fdrNumber).toBe(d.fdrNumber);
      const none = await inst
        .upload('/api/ocr/preview', 'file', uniquePdf('x'), 'scan.pdf')
        .expect(200);
      expect((none.body as { preview: unknown; error: string }).error).toMatch(/unavailable/);
      await inst
        .upload('/api/ocr/preview', 'file', Buffer.from('not a scan'), 'scan.txt')
        .expect(400);
    });
  });

  describe('legacy batch', () => {
    let batchId: string;
    let good: ReturnType<typeof declaration>;

    it('only regional officers may upload', async () => {
      await inst.upload('/api/legacy/batches', 'files', uniquePdf('a'), 'a.pdf').expect(403);
    });

    it('accepts PDFs and ZIP archives and OCRs them in the background', async () => {
      good = declaration(bankCode, { depositorNames: ['AICTE', 'Test Trust A'] });
      const zip = Buffer.from(
        zipSync({
          'scans/good.pdf': new Uint8Array(scanFor(good)),
          'readme.txt': new TextEncoder().encode('ignored'),
        }),
      );
      const res = await ro
        .uploadMany(
          '/api/legacy/batches',
          'files',
          [
            { file: zip, name: 'box.zip' },
            { file: uniquePdf('blank'), name: 'blank.pdf' },
          ],
          { label: 'Cupboard 3' },
        )
        .expect(201);
      const b = res.body as LegacyBatchView;
      batchId = b.id;
      expect(b.fileCount).toBe(2);

      let view: LegacyBatchView = b;
      for (let i = 0; i < 50 && view.counts.ocrRunning > 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
        view = (await ro.get(`/api/legacy/batches/${batchId}`).expect(200)).body as LegacyBatchView;
      }
      expect(view.counts.ocrRunning).toBe(0);
      const goodItem = view.items!.find((i) => i.fileName.endsWith('good.pdf'))!;
      expect(goodItem.ocr?.fields.fdrNumber).toBe(good.fdrNumber);
      expect(goodItem.suggestedInstitution?.id).toBe(fx.institutionId);
      const blank = view.items!.find((i) => i.fileName === 'blank.pdf')!;
      expect(blank.ocrError).toMatch(/unavailable/);
    });

    it('is invisible to other regions', async () => {
      await otherRo.get(`/api/legacy/batches/${batchId}`).expect(404);
      expect(
        ((await otherRo.get('/api/legacy/batches').expect(200)).body as unknown[]).length,
      ).toBe(0);
    });

    it('lists unreviewed items in the reconciliation report', async () => {
      const r = (await ro.get('/api/legacy/reconciliation').expect(200))
        .body as ReconciliationReport;
      expect(r.counts.UNREVIEWED).toBe(2);
      expect(
        r.rows.some((x) => x.kind === 'MISSING' && x.institutionId === emptyInstitutionId),
      ).toBe(true);
      expect(r.rows.some((x) => x.institutionId === fx.otherInstitutionId)).toBe(false);
    });

    it('confirming creates a legacy instrument under scrutiny with officer-verified fields', async () => {
      const view = (await ro.get(`/api/legacy/batches/${batchId}`).expect(200))
        .body as LegacyBatchView;
      const item = view.items!.find((i) => i.fileName.endsWith('good.pdf'))!;
      // The officer reads the physical original and corrects the amount the scan got wrong.
      const declared = { ...good, amount: Number(good.amount) + 1000 };
      await ro
        .post(`/api/legacy/items/${item.id}/confirm`, {
          institutionId: fx.otherInstitutionId,
          declaration: declared,
        })
        .expect(400);
      const res = await ro.post(`/api/legacy/items/${item.id}/confirm`, {
        institutionId: fx.institutionId,
        declaration: declared,
      });
      expect(res.status).toBe(200);
      const { instrumentId } = res.body as { instrumentId: string; refNo: string };

      const det = await detail(ro, instrumentId);
      expect(det.status).toBe('UNDER_SCRUTINY');
      expect(det.legacy).toBe(true);
      expect(det.documents.map((d) => d.type)).toEqual(['FDR_SCAN']);
      const amount = det.fields.find((f) => f.field === 'amount')!;
      expect(amount.effectiveTrust).toBe('OFFICER_VERIFIED');
      expect(amount.mismatch).toBe(true);

      await ro
        .post(`/api/legacy/items/${item.id}/confirm`, {
          institutionId: fx.institutionId,
          declaration: declared,
        })
        .expect(409);

      const r = (await ro.get('/api/legacy/reconciliation').expect(200))
        .body as ReconciliationReport;
      expect(r.counts.UNREVIEWED).toBe(1);
      expect(r.rows.some((x) => x.kind === 'MISMATCHED' && x.instrumentId === instrumentId)).toBe(
        true,
      );
    });

    it('rejecting removes the item from the review queue; CSV export works', async () => {
      const view = (await ro.get(`/api/legacy/batches/${batchId}`).expect(200))
        .body as LegacyBatchView;
      const blank = view.items!.find((i) => i.fileName === 'blank.pdf')!;
      await ro.post(`/api/legacy/items/${blank.id}/reject`, { note: 'Not an FDR' }).expect(200);
      const after = (await ro.get(`/api/legacy/batches/${batchId}`).expect(200))
        .body as LegacyBatchView;
      expect(after.counts).toMatchObject({ pending: 0, confirmed: 1, rejected: 1 });

      const csv = await ro.get('/api/legacy/reconciliation?format=csv').expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text).toContain('MISMATCHED');
    });
  });
});
