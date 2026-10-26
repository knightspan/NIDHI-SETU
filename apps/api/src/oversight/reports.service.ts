import { Injectable } from '@nestjs/common';
import type { ReportFormat, ReportQuery, ReportType } from '@nidhisetu/shared';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AuditService } from '../audit/audit.service.js';
import { actorOf } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { addDays, daysBetween, toIso } from '../domain/dates.js';
import { InvalidInputError } from '../domain/errors.js';
import { instrumentScope, type Principal } from '../domain/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RulesService } from '../rules/rules.service.js';
import { InstitutionsService } from './institutions.service.js';

export interface Table {
  title: string;
  subtitle: string;
  columns: { key: string; label: string; width?: number; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
}

const PRE_ACTIVE_REVIEW = [
  'SUBMITTED',
  'UNDER_SCRUTINY',
  'DISCREPANCY_RAISED',
  'OFFICER_VERIFIED',
  'BANK_CONFIRMATION_PENDING',
  'BANK_CONFIRMED',
] as const;

/** Spreadsheet formula injection guard: values starting with = + - @ are prefixed with an apostrophe. */
export function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 byte-order mark so Excel opens the CSV as UTF-8 (rupee sign, Hindi names). */
const BOM = String.fromCharCode(0xfeff);

export function toCsv(t: Table): string {
  const lines = [t.columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map((c) => csvCell(r[c.key] ?? null)).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Management reports (Section 7 · cap 8), scoped to the caller and exportable as CSV / XLSX / PDF. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly rules: RulesService,
    private readonly institutions: InstitutionsService,
    private readonly audit: AuditService,
  ) {}

  async build(p: Principal, type: ReportType, q: ReportQuery): Promise<Table> {
    const scope = instrumentScope(p) as Prisma.InstrumentWhereInput;
    const today = this.clock.today();
    const common = {
      institution: { select: { name: true, aicteId: true, region: { select: { name: true } } } },
      bank: { select: { name: true } },
    } as const;

    switch (type) {
      case 'pending-verifications': {
        const rows = await this.prisma.instrument.findMany({
          where: { AND: [scope, { status: { in: [...PRE_ACTIVE_REVIEW] } }] },
          include: {
            ...common,
            _count: {
              select: { discrepancies: { where: { status: { in: ['OPEN', 'RESPONDED'] } } } },
            },
          },
          orderBy: { submittedAt: 'asc' },
        });
        return {
          title: 'Pending verifications',
          subtitle: 'Submitted instruments not yet confirmed by the bank, oldest first',
          columns: [
            { key: 'ref', label: 'Reference' },
            { key: 'institution', label: 'Institution', width: 34 },
            { key: 'aicteId', label: 'AICTE ID' },
            { key: 'region', label: 'Region' },
            { key: 'bank', label: 'Bank' },
            { key: 'fdr', label: 'FDR no.' },
            { key: 'amount', label: 'Amount (₹)', numeric: true },
            { key: 'status', label: 'Status' },
            { key: 'submitted', label: 'Submitted' },
            { key: 'days', label: 'Days pending', numeric: true },
            { key: 'open', label: 'Open discrepancies', numeric: true },
          ],
          rows: rows.map((i) => ({
            ref: i.refNo,
            institution: i.institution.name,
            aicteId: i.institution.aicteId,
            region: i.institution.region.name,
            bank: i.bank?.name ?? i.bankCode,
            fdr: i.fdrNumber,
            amount: Number(i.amount ?? 0),
            status: i.status,
            submitted: i.submittedAt ? toIso(i.submittedAt) : null,
            days: i.submittedAt ? daysBetween(i.submittedAt, today) : null,
            open: i._count.discrepancies,
          })),
        };
      }
      case 'upcoming-maturities': {
        const rows = await this.prisma.instrument.findMany({
          where: {
            AND: [
              scope,
              {
                status: { in: ['ACTIVE', 'RENEWAL_PENDING'] },
                maturityDate: { lte: addDays(today, q.days) },
              },
            ],
          },
          include: { ...common, replacedBy: { select: { refNo: true, status: true } } },
          orderBy: { maturityDate: 'asc' },
        });
        return {
          title: 'Upcoming maturities',
          subtitle: `Held deposits maturing within ${q.days} days (or already matured), soonest first`,
          columns: [
            { key: 'ref', label: 'Reference' },
            { key: 'institution', label: 'Institution', width: 34 },
            { key: 'region', label: 'Region' },
            { key: 'bank', label: 'Bank' },
            { key: 'fdr', label: 'FDR no.' },
            { key: 'amount', label: 'Amount (₹)', numeric: true },
            { key: 'maturity', label: 'Maturity' },
            { key: 'daysLeft', label: 'Days left', numeric: true },
            { key: 'validity', label: 'Validity' },
            { key: 'renewal', label: 'Replacement' },
          ],
          rows: rows.map((i) => ({
            ref: i.refNo,
            institution: i.institution.name,
            region: i.institution.region.name,
            bank: i.bank?.name ?? i.bankCode,
            fdr: i.fdrNumber,
            amount: Number(i.amount ?? 0),
            maturity: i.maturityDate ? toIso(i.maturityDate) : null,
            daysLeft: i.maturityDate ? daysBetween(today, i.maturityDate) : null,
            validity: i.validityStatus,
            renewal: i.replacedBy ? `${i.replacedBy.refNo} (${i.replacedBy.status})` : '—',
          })),
        };
      }
      case 'missing-documents': {
        const mandatory = (await this.rules.get('discrepancy.rules')).mandatoryDocuments;
        const rows = await this.prisma.instrument.findMany({
          where: {
            AND: [scope, { status: { notIn: ['DRAFT', 'REJECTED', 'RELEASED', 'RENEWED'] } }],
          },
          include: { ...common, documents: { select: { type: true } } },
          orderBy: { refNo: 'asc' },
        });
        return {
          title: 'Missing documents',
          subtitle: `Instruments lacking a mandatory document (${mandatory.join(', ')})`,
          columns: [
            { key: 'ref', label: 'Reference' },
            { key: 'institution', label: 'Institution', width: 34 },
            { key: 'region', label: 'Region' },
            { key: 'status', label: 'Status' },
            { key: 'legacy', label: 'Legacy' },
            { key: 'missing', label: 'Missing', width: 24 },
          ],
          rows: rows
            .map((i) => ({
              i,
              missing: mandatory.filter((m) => !i.documents.some((d) => d.type === m)),
            }))
            .filter((x) => x.missing.length > 0)
            .map(({ i, missing }) => ({
              ref: i.refNo,
              institution: i.institution.name,
              region: i.institution.region.name,
              status: i.status,
              legacy: i.legacy ? 'Yes' : 'No',
              missing: missing.join(', '),
            })),
        };
      }
      case 'intervention': {
        const [high, overdue, bank, esc] = await Promise.all([
          this.prisma.discrepancy.findMany({
            where: { status: { in: ['OPEN', 'RESPONDED'] }, severity: 'HIGH', instrument: scope },
            include: { instrument: { include: common } },
          }),
          this.prisma.instrument.findMany({
            where: { AND: [scope, { validityStatus: 'OVERDUE_RENEWAL' }] },
            include: common,
          }),
          this.prisma.bankConfirmationRequest.findMany({
            where: {
              instrument: scope,
              OR: [{ status: 'FAILED' }, { status: 'PENDING', slaDueAt: { lt: this.clock.now() } }],
            },
            include: { instrument: { include: common }, bank: true },
          }),
          this.prisma.escalation.findMany({ where: { resolvedAt: null, level: { gte: 2 } } }),
        ]);
        const escalatedIds = new Set(esc.map((e) => e.instrumentId));
        const escInst = await this.prisma.instrument.findMany({
          where: {
            AND: [scope, { id: { in: [...escalatedIds].filter((x): x is string => !!x) } }],
          },
          include: common,
        });
        const row = (
          i: { refNo: string; institution: { name: string; region: { name: string } } },
          issue: string,
          detail: string,
          since: Date | null,
        ) => ({
          ref: i.refNo,
          institution: i.institution.name,
          region: i.institution.region.name,
          issue,
          detail,
          since: since ? toIso(since) : null,
        });
        return {
          title: 'Cases needing intervention',
          subtitle:
            'High-severity discrepancies, overdue renewals, stalled bank confirmations and escalations at level 2+',
          columns: [
            { key: 'ref', label: 'Reference' },
            { key: 'institution', label: 'Institution', width: 30 },
            { key: 'region', label: 'Region' },
            { key: 'issue', label: 'Issue', width: 22 },
            { key: 'detail', label: 'Detail', width: 50 },
            { key: 'since', label: 'Since' },
          ],
          rows: [
            ...high.map((d) =>
              row(d.instrument, `Discrepancy: ${d.ruleCode}`, d.description, d.createdAt),
            ),
            ...overdue.map((i) =>
              row(
                i,
                'Overdue renewal',
                `Matured ${i.maturityDate ? toIso(i.maturityDate) : '?'}`,
                i.maturityDate,
              ),
            ),
            ...bank.map((b) =>
              row(
                b.instrument,
                'Bank confirmation stalled',
                `${b.bank.name}: ${b.status}${b.failureReason ? ` (${b.failureReason})` : ''}`,
                b.createdAt,
              ),
            ),
            ...escInst.map((i) => {
              const e = esc
                .filter((x) => x.instrumentId === i.id)
                .sort((a, b) => b.level - a.level)[0]!;
              return row(i, `Escalation L${e.level}`, e.reason, e.createdAt);
            }),
          ],
        };
      }
      case 'institution-statement': {
        if (!q.institutionId)
          throw new InvalidInputError('institutionId is required for an institution statement');
        const s = await this.institutions.statement(p, q.institutionId);
        return {
          title: `Statement: ${s.name}`,
          subtitle: `${s.aicteId} · ${s.regionName} · held ₹${Number(s.heldAmount).toLocaleString('en-IN')} against ₹${Number(s.required).toLocaleString('en-IN')} required${s.exempt ? ' (exempt)' : ''} · ${s.compliant ? 'compliant' : 'SHORTFALL'}`,
          columns: [
            { key: 'ref', label: 'Reference' },
            { key: 'bank', label: 'Bank' },
            { key: 'fdr', label: 'FDR no.' },
            { key: 'amount', label: 'Amount (₹)', numeric: true },
            { key: 'issue', label: 'Issue date' },
            { key: 'maturity', label: 'Maturity' },
            { key: 'status', label: 'Status' },
            { key: 'validity', label: 'Validity' },
            { key: 'trust', label: 'Trust score', numeric: true },
          ],
          rows: s.instruments.map((i) => ({
            ref: i.refNo,
            bank: i.bankName ?? i.bankCode,
            fdr: i.fdrNumber,
            amount: Number(i.amount ?? 0),
            issue: i.issueDate,
            maturity: i.maturityDate,
            status: i.status,
            validity: i.validityStatus,
            trust: i.trustScore,
          })),
        };
      }
    }
  }

  async export(
    p: Principal,
    type: ReportType,
    q: ReportQuery,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const table = await this.build(p, type, q);
    const stamp = this.clock.todayIso();
    const filename = `nidhisetu-${type}-${stamp}.${q.format}`;
    await this.audit.record({
      actor: actorOf(p),
      action: 'report.exported',
      entityType: 'Report',
      entityId: type,
      data: {
        format: q.format,
        rows: table.rows.length,
        institutionId: q.institutionId,
        days: q.days,
      },
    });
    return {
      body: await this.render(table, q.format, stamp),
      contentType: CONTENT_TYPES[q.format],
      filename,
    };
  }

  async render(t: Table, format: ReportFormat, stamp: string): Promise<Buffer> {
    switch (format) {
      case 'csv':
        return Buffer.from(toCsv(t), 'utf8');
      case 'xlsx':
        return this.xlsx(t, stamp);
      case 'pdf':
        return this.pdf(t, stamp);
    }
  }

  private async xlsx(t: Table, stamp: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'NidhiSetu';
    const ws = wb.addWorksheet(t.title.slice(0, 31));
    ws.addRow([t.title]).font = { bold: true, size: 14 };
    ws.addRow([`${t.subtitle} · generated ${stamp} · fictional demo data`]).font = {
      italic: true,
      color: { argb: 'FF555555' },
    };
    ws.addRow([]);
    const header = ws.addRow(t.columns.map((c) => c.label));
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE6FF' } };
    for (const r of t.rows) ws.addRow(t.columns.map((c) => r[c.key] ?? null));
    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.max(12, c.label.length + 2);
      if (c.key === 'amount') col.numFmt = '#,##,##0';
    });
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4 + t.rows.length, column: t.columns.length },
    };
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private pdf(t: Table, stamp: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 36,
        info: { Title: t.title, Author: 'NidhiSetu' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const ascii = (s: string) => s.replace(/₹/g, 'Rs.').replace(/[^\x20-\x7E]/g, '');
      doc.fontSize(16).font('Helvetica-Bold').text(ascii(t.title));
      doc
        .moveDown(0.2)
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#555555')
        .text(ascii(`${t.subtitle} - generated ${stamp} - fictional demo data`));
      doc.moveDown(0.6).fillColor('#000000');

      const width = doc.page.width - 72;
      const weights = t.columns.map((c) => c.width ?? 14);
      const total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / total) * width);
      const drawRow = (cells: string[], bold: boolean) => {
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
        const heights = cells.map((c, i) => doc.heightOfString(c, { width: widths[i]! - 4 }));
        const h = Math.max(...heights, 10) + 4;
        if (y + h > doc.page.height - 36) {
          doc.addPage();
          return drawRow(cells, bold);
        }
        if (bold) doc.rect(36, y, width, h).fill('#dbe6ff').fillColor('#000000');
        let x = 36;
        cells.forEach((c, i) => {
          doc.text(c, x + 2, y + 2, {
            width: widths[i]! - 4,
            align: t.columns[i]!.numeric ? 'right' : 'left',
          });
          x += widths[i]!;
        });
        doc
          .moveTo(36, y + h)
          .lineTo(36 + width, y + h)
          .strokeColor('#dddddd')
          .lineWidth(0.5)
          .stroke();
        doc.y = y + h;
        doc.x = 36;
      };
      drawRow(
        t.columns.map((c) => ascii(c.label)),
        true,
      );
      for (const r of t.rows) {
        drawRow(
          t.columns.map((c) => {
            const v = r[c.key];
            if (v === null || v === undefined) return '';
            return ascii(
              c.key === 'amount' && typeof v === 'number' ? v.toLocaleString('en-IN') : String(v),
            );
          }),
          false,
        );
      }
      if (t.rows.length === 0) doc.moveDown().font('Helvetica-Oblique').text('No rows.');
      doc.end();
    });
  }
}

const CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
