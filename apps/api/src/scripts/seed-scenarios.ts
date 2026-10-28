/**
 * Demo scenarios: replays the history of ~150 fictional deposits through the real services on a
 * simulated clock, so every record has a consistent lifecycle, discrepancies, bank answers,
 * notifications and a hash-chained audit trail in chronological order.
 *
 * All names, FDR numbers and amounts are made up. Dates are relative to the real "today", so a reset
 * always produces a fresh-looking portfolio (some deposits expiring soon, some overdue, …).
 */
import type { INestApplicationContext } from '@nestjs/common';
import {
  DEFAULT_RULES,
  FIELD_KEYS,
  InstrumentDeclarationSchema,
  type DocumentType,
  type FieldKey,
  type InstrumentDeclaration,
  type InstrumentDeclarationInput,
  type OcrPreview,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import { BankService } from '../bank/bank.service.js';
import { ClockService } from '../clock/clock.service.js';
import { SYSTEM_ACTOR, actorOf } from '../common/actor.js';
import { DiscrepanciesService } from '../discrepancies/discrepancies.service.js';
import { ScrutinyService } from '../discrepancies/scrutiny.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { istDateIso } from '../domain/dates.js';
import { requiredAmount } from '../domain/discrepancy-rules.js';
import type { Principal } from '../domain/scope.js';
import { AssertionsService } from '../instruments/assertions.service.js';
import { InstrumentsService, declarationToAssertions } from '../instruments/instruments.service.js';
import { TransitionsService } from '../instruments/transitions.service.js';
import { LifecycleService } from '../jobs/lifecycle.service.js';
import { ForfeitureService } from '../forfeiture/forfeiture.service.js';
import { LegacyService } from '../legacy/legacy.service.js';
import { TaxService } from '../tax/tax.service.js';
import { maturityValueFor, tenureYears } from '../domain/maturity-math.js';
import { expectedInterestForFy } from '../domain/tax-heartbeat.js';
import { HELD_STATES } from '@nidhisetu/shared';
import { SEED_BANKS, SEED_IFSC } from './seed-master.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReleasesService } from '../releases/releases.service.js';
import { fdrPdf, letterPdf } from './seed-pdf.js';
import { mulberry32, pick } from './seed-institutions.js';

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const T = istDateIso(new Date());
const d = (offsetDays: number, from = T) =>
  new Date(Date.parse(`${from}T00:00:00Z`) + offsetDays * DAY).toISOString().slice(0, 10);
const plusYears = (iso: string, years: number) =>
  `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;
const minDate = (a: string, b: string) => (a < b ? a : b);

/** Declaration fields a scenario may override (amount is always a number here). */
type DeclOverrides = Omit<Partial<InstrumentDeclarationInput>, 'amount'>;

// ─── Timeline ───────────────────────────────────────────────────────────────

interface Step {
  at: string;
  seq: number;
  label: string;
  /** Steps with the same key on the same day run in order; different keys run in parallel. */
  key: string;
  run: () => Promise<void>;
}

/** Runs alone, after the day's parallel steps (touches several institutions). */
const BARRIER = '*';

class Timeline {
  readonly steps: Step[] = [];
  private seq = 0;
  add(at: string, key: string, label: string, run: () => Promise<void>): void {
    if (at > T) at = T; // never in the future
    this.steps.push({ at, seq: this.seq++, key, label, run });
  }
}

/** Deterministic pseudo-confidence in [0.90, 0.99] (no shared PRNG inside parallel steps). */
function confidenceFor(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 0.9 + (h % 10) / 100;
}

/** Filled in when the "create" step runs. */
interface Ref {
  id?: string;
  refNo?: string;
  scan?: Buffer;
  decl?: InstrumentDeclaration;
}

// ─── People ─────────────────────────────────────────────────────────────────

interface Inst {
  id: string;
  index: number;
  aicteId: string;
  name: string;
  trustName: string;
  regionId: string;
  regionCode: string;
  yearEstablished: number;
  programmes: string[];
  required: number;
  young: boolean;
}

const BANK_STYLE: Record<string, { label: string; fdr: (year: string, n: number) => string }> = {
  SBIN: { label: 'State Bank of India', fdr: (y, n) => `SBI/FD/${y}/${100000 + n}` },
  PUNB: {
    label: 'Punjab National Bank',
    fdr: (_y, n) => `PNB-FDR-${String(40000 + n).padStart(7, '0')}`,
  },
  BARB: { label: 'Bank of Baroda', fdr: (_y, n) => `BOB/TDR/${700000 + n}` },
  CNRB: { label: 'Canara Bank', fdr: (y, n) => `CNRB/FD/${y}/${3000 + n}` },
  UBIN: { label: 'Union Bank of India', fdr: (y, n) => `UBI-${y}-${500000 + n}` },
  HDFC: { label: 'HDFC Bank', fdr: (_y, n) => `5030${String(1000000 + n).padStart(10, '0')}` },
  ICIC: { label: 'ICICI Bank', fdr: (_y, n) => `ICIC/FD/${880000 + n}` },
  UTIB: { label: 'Axis Bank', fdr: (y, n) => `AXIS-FD-${y}-${60000 + n}` },
};
const DESK_BANKS = ['SBIN', 'PUNB', 'BARB', 'CNRB', 'UBIN', 'UTIB'];
const ALL_BANKS = Object.keys(BANK_STYLE);

export interface ScenarioSummary {
  instruments: number;
  steps: number;
  seconds: number;
  byStatus: Record<string, number>;
}

export async function seedScenarios(
  app: INestApplicationContext,
  opts: { quiet?: boolean } = {},
): Promise<ScenarioSummary> {
  const log = (m: string) => !opts.quiet && console.log(m);
  const started = Date.now();
  const prisma = app.get(PrismaService);
  const svc = {
    instruments: app.get(InstrumentsService),
    documents: app.get(DocumentsService),
    assertions: app.get(AssertionsService),
    transitions: app.get(TransitionsService),
    scrutiny: app.get(ScrutinyService),
    discrepancies: app.get(DiscrepanciesService),
    bank: app.get(BankService),
    releases: app.get(ReleasesService),
    legacy: app.get(LegacyService),
    lifecycle: app.get(LifecycleService),
    clock: app.get(ClockService),
    audit: app.get(AuditService),
    notifications: app.get(NotificationsService),
    tax: app.get(TaxService),
    forfeiture: app.get(ForfeitureService),
  };
  // Inboxes should show the last two months, not five years of history.
  svc.notifications.quietBefore = new Date(Date.parse(`${d(-60)}T00:00:00+05:30`));
  const rnd = mulberry32(2026_265);

  // Principals ---------------------------------------------------------------
  const users = await prisma.user.findMany();
  const principal = (u: (typeof users)[number]): Principal => ({
    id: u.id,
    role: u.role,
    regionId: u.regionId,
    institutionId: u.institutionId,
    bankId: u.bankId,
  });
  const byRole = (role: string) => users.filter((u) => u.role === role).map(principal);
  const instUser = new Map(byRole('INSTITUTION_USER').map((p) => [p.institutionId!, p]));
  const roByRegion = new Map(byRole('RO_OFFICER').map((p) => [p.regionId!, p]));
  const bankOfficer = new Map(byRole('BANK_OFFICER').map((p) => [p.bankId!, p]));
  const [bureau] = byRole('BUREAU_OFFICER');
  const [authority] = byRole('COMPETENT_AUTHORITY');
  const [finance] = byRole('FINANCE_OFFICER');
  if (!bureau || !authority || !finance) throw new Error('Seed users missing');

  const rules = DEFAULT_RULES;
  const regions = await prisma.region.findMany();
  const regionCode = new Map(regions.map((r) => [r.id, r.code]));
  const institutions: Inst[] = (
    await prisma.institution.findMany({ orderBy: { aicteId: 'asc' } })
  ).map((i, idx) => {
    const req = requiredAmount(
      i,
      rules['eligibility.exemption'],
      rules['amount.required'],
      new Date(`${T}T00:00:00Z`),
    );
    return {
      id: i.id,
      index: idx + 1,
      aicteId: i.aicteId,
      name: i.name,
      trustName: i.trustName,
      regionId: i.regionId,
      regionCode: regionCode.get(i.regionId)!,
      yearEstablished: i.yearEstablished,
      programmes: i.programmes,
      required: req.required,
      young: !req.exempt,
    };
  });
  const ro = (inst: Inst) => roByRegion.get(inst.regionId)!;
  const ip = (inst: Inst) => instUser.get(inst.id)!;

  // Builders -----------------------------------------------------------------
  const tl = new Timeline();
  let serial = 0;

  const declaration = (
    inst: Inst,
    o: { bank: string; issue: string; maturity: string; amount: number } & DeclOverrides,
  ): InstrumentDeclaration => {
    serial++;
    const style = BANK_STYLE[o.bank]!;
    const branch = pick(
      rnd,
      SEED_IFSC.filter((r) => r.bankCode === o.bank),
    );
    // Rates 6.50–7.50 % p.a.; the printed maturity value follows the bank's compounding.
    const rate = 6.5 + Math.floor(rnd() * 5) * 0.25;
    const compounding = SEED_BANKS.find((b) => b.code === o.bank)?.compounding ?? 'QUARTERLY';
    const maturityValue = Math.round(
      maturityValueFor(o.amount, rate, tenureYears(o.issue, o.maturity), compounding),
    );
    return InstrumentDeclarationSchema.parse({
      type: 'FDR',
      bankCode: o.bank,
      branch: branch.branch,
      ifsc: branch.ifsc,
      fdrNumber: style.fdr(o.issue.slice(0, 4), serial),
      amount: o.amount,
      interestRate: rate,
      maturityValue,
      issueDate: o.issue,
      maturityDate: o.maturity,
      depositorNames: ['AICTE', inst.trustName.replace(' (fictional)', '').toUpperCase()],
      lienMarked: true,
      autoRenewal: false,
      ...Object.fromEntries(
        Object.entries(o).filter(([k]) => !['bank', 'issue', 'maturity'].includes(k)),
      ),
    });
  };

  const upload = async (
    p: Principal,
    id: string,
    type: DocumentType,
    buffer: Buffer,
    name: string,
  ) =>
    (
      await svc.documents.uploadForInstrument(p, id, type, {
        buffer,
        originalname: name,
        size: buffer.length,
      })
    ).doc;

  /** Records what OCR read from the scan (normally the OCR service does this on upload). */
  /**
   * Stores the scan and records what OCR read from it, in one transaction (the API does the same in
   * two steps: upload, then the OCR service's answer).
   */
  const scanWithOcr = async (
    inst: Inst,
    id: string,
    scan: Buffer,
    decl: InstrumentDeclaration,
    overrides: Partial<InstrumentDeclaration>,
  ) => {
    const uploader = actorOf(ip(inst));
    const read = { ...decl, ...overrides };
    await prisma.$transaction(async (tx) => {
      const doc = await svc.documents.store(tx, {
        file: {
          buffer: scan,
          originalname: `fdr-${decl.fdrNumber.replace(/\W+/g, '-')}.pdf`,
          size: scan.length,
        },
        type: 'FDR_SCAN',
        instrumentId: id,
        institutionId: inst.id,
        actor: uploader,
      });
      const inputs = declarationToAssertions(read, 'ocr:rapidocr')
        .filter((a) => !['lienMarked', 'autoRenewal'].includes(a.field))
        .map((a) => ({
          ...a,
          trust: 'OCR_EXTRACTED' as const,
          confidence: a.field in overrides ? 0.71 : confidenceFor(`${decl.fdrNumber}:${a.field}`),
          evidenceDocumentId: doc.id,
        }));
      await svc.assertions.apply(tx, id, inputs, SYSTEM_ACTOR);
      await svc.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'ocr.extracted',
          entityType: 'Document',
          entityId: doc.id,
          data: { instrumentId: id, engine: 'rapidocr', fields: inputs.map((i) => i.field) },
        },
        tx,
      );
      await svc.instruments.afterChange(tx, id, SYSTEM_ACTOR);
    });
  };

  const openDiscrepancies = (id: string) =>
    prisma.discrepancy.findMany({
      where: { instrumentId: id, status: { in: ['OPEN', 'RESPONDED'] } },
    });

  type Stage = 'DRAFT' | 'SUBMITTED' | 'SCRUTINY' | 'VERIFIED' | 'BANK_PENDING' | 'ACTIVE';
  interface DepositOpts {
    inst: Inst;
    bank: string;
    created: string;
    issue: string;
    maturity: string;
    amount: number;
    stage: Stage;
    decl?: DeclOverrides;
    /** Values OCR "misread" (cause a mismatch). */
    ocr?: Partial<InstrumentDeclaration>;
    replaces?: Ref;
    /** Re-use another deposit's declaration and scan bytes (duplicate-FDR fraud case). */
    copyOf?: Ref;
    noScan?: boolean;
    delays?: { scrutiny?: number; verify?: number; bank?: number };
  }

  const activeRefs: { ref: Ref; inst: Inst; activeFrom: string }[] = [];

  /** Registers the steps that take one deposit from declaration to `stage`. */
  const deposit = (o: DepositOpts): Ref => {
    const ref: Ref = {};
    if (o.stage === 'ACTIVE') activeRefs.push({ ref, inst: o.inst, activeFrom: d(20, o.created) });
    const inst = o.inst;
    const scrutinyAt = d(o.delays?.scrutiny ?? 2 + Math.floor(rnd() * 5), d(1, o.created));
    const verifyAt = d(o.delays?.verify ?? 1 + Math.floor(rnd() * 4), scrutinyAt);
    const bankAt = d(o.delays?.bank ?? 1 + Math.floor(rnd() * 6), verifyAt);
    // Declared up front so the PRNG is consumed in registration order (deterministic output).
    const decl = o.copyOf
      ? InstrumentDeclarationSchema.parse({ ...o.copyOf.decl!, ...o.decl })
      : declaration(inst, {
          bank: o.bank,
          issue: o.issue,
          maturity: o.maturity,
          amount: o.amount,
          ...o.decl,
        });
    ref.decl = decl;
    tl.add(o.created, inst.id, 'create', async () => {
      const r = o.replaces
        ? await svc.instruments.createReplacement(ip(inst), o.replaces.id!, decl)
        : await svc.instruments.create(ip(inst), decl);
      ref.id = r.id;
      ref.refNo = r.refNo;
      if (o.noScan) return;
      ref.scan =
        o.copyOf?.scan ??
        (await fdrPdf({ ...decl, bankName: BANK_STYLE[o.bank]!.label, nonce: `${r.refNo}` }));
      await scanWithOcr(inst, r.id, ref.scan, decl, o.ocr ?? {});
    });
    if (o.stage === 'DRAFT') return ref;
    tl.add(d(1, o.created), inst.id, 'submit', async () => {
      await svc.instruments.submit(ip(inst), ref.id!);
    });
    if (o.stage === 'SUBMITTED') return ref;
    tl.add(scrutinyAt, inst.id, 'begin scrutiny', async () => {
      await svc.scrutiny.begin(ro(inst), ref.id!);
    });
    if (o.stage === 'SCRUTINY') return ref;
    tl.add(verifyAt, inst.id, 'verify', async () => {
      for (const x of await openDiscrepancies(ref.id!)) {
        await svc.discrepancies.close(ro(inst), x.id, {
          resolution: 'WAIVED',
          note: 'Checked against the original; acceptable.',
        });
      }
      await svc.scrutiny.verifyFields(ro(inst), ref.id!, {
        items: FIELD_KEYS.map((field) => ({ field })),
      });
      await svc.scrutiny.markVerified(ro(inst), ref.id!);
    });
    if (o.stage === 'VERIFIED') return ref;
    tl.add(verifyAt, inst.id, 'send to bank', async () => {
      await svc.bank.sendToBank(ro(inst), ref.id!);
    });
    if (o.stage === 'BANK_PENDING' || !DESK_BANKS.includes(o.bank)) return ref; // API banks answer at once
    tl.add(bankAt, inst.id, 'bank confirms', async () => {
      await bankAnswer(ref, inst, true);
    });
    return ref;
  };

  const bankAnswer = async (ref: Ref, inst: Inst, ok: boolean) => {
    const req = await prisma.bankConfirmationRequest.findFirstOrThrow({
      where: { instrumentId: ref.id!, status: { in: ['PENDING', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
    });
    const decl = ref.decl!;
    await svc.bank.respond(bankOfficer.get(req.bankId)!, req.id, {
      exists: true,
      lienMarked: ok,
      maturityDate: decl.maturityDate,
      autoRenewal: decl.autoRenewal,
      amount: decl.amount,
      reference: `BR/${req.id.slice(0, 6).toUpperCase()}`,
      remarks: ok
        ? 'Deposit exists; lien noted in favour of AICTE.'
        : 'Lien is NOT marked in favour of AICTE on our records.',
    });
    void inst;
  };

  /** Release workflow on an active deposit, up to `until`. */
  const release = (
    ref: Ref,
    inst: Inst,
    at: string,
    until: 'REQUESTED' | 'RECOMMENDED' | 'APPROVED' | 'EXECUTED' | 'DECLINED' | 'REJECTED',
  ) => {
    let releaseId = '';
    /** The approval gate needs a bank PASS from the last N days: re-attest first. */
    const reattest = (when: string) => {
      tl.add(when, inst.id, 'reattest', async () => {
        await svc.bank.requestReattestation(
          ref.id!,
          'Re-verification before the release decision',
          ro(inst),
        );
      });
      tl.add(d(1, when), inst.id, 'bank re-attests', async () => {
        const open = await prisma.bankConfirmationRequest.findFirst({
          where: { instrumentId: ref.id!, status: { in: ['PENDING', 'FAILED'] } },
        });
        if (open) await bankAnswer(ref, inst, true);
      });
    };
    tl.add(at, inst.id, 'release request', async () => {
      const noc = await letterPdf(
        'No Objection Certificate',
        `The institution requests discharge of FDR ${ref.decl!.fdrNumber}. All fictional.`,
        `NOC-${ref.refNo}`,
      );
      await upload(ip(inst), ref.id!, 'NOC', noc, 'noc.pdf');
      releaseId = (
        await svc.releases.request(
          ip(inst),
          ref.id!,
          'Institution is no longer required to hold this deposit.',
        )
      ).id;
    });
    // Releases still in flight get a recent re-attestation, ready for the competent authority.
    if ((until === 'REQUESTED' || until === 'RECOMMENDED') && d(-3) > d(4, at)) reattest(d(-3));
    if (until === 'REQUESTED') return;
    if (until === 'DECLINED') {
      tl.add(d(4, at), inst.id, 'release declined', async () => {
        await svc.releases.decline(
          ro(inst),
          releaseId,
          'Renewal is due first; resubmit after the replacement is active.',
        );
      });
      return;
    }
    tl.add(d(3, at), inst.id, 'release recommend', async () => {
      await svc.releases.recommend(ro(inst), releaseId, 'All preconditions met; recommended.');
    });
    if (until === 'RECOMMENDED') return;
    if (until === 'REJECTED') {
      tl.add(d(9, at), inst.id, 'release rejected', async () => {
        await svc.releases.rejectByAuthority(
          authority,
          releaseId,
          'Pending verification of the institution’s approval status.',
        );
      });
      return;
    }
    reattest(d(5, at));
    tl.add(d(8, at), inst.id, 'release approve', async () => {
      await svc.releases.approve(authority, releaseId, 'Approved under delegated powers.');
    });
    if (until === 'APPROVED') return;
    tl.add(d(12, at), inst.id, 'release execute', async () => {
      await svc.releases.execute(finance, releaseId, {
        executionRef: `FIN/REL/${at.slice(0, 4)}/${String(++serial).padStart(4, '0')}`,
        executionDate: d(12, at),
      });
    });
  };

  const bankFor = (inst: Inst, k = 0) => ALL_BANKS[(inst.index + k) % ALL_BANKS.length]!;
  const deskBankFor = (inst: Inst, k = 0) => DESK_BANKS[(inst.index + k) % DESK_BANKS.length]!;
  const amountFor = (inst: Inst) => Math.max(inst.required, 500_000);

  // ─── Scenarios ─────────────────────────────────────────────────────────────

  const young = institutions.filter((i) => i.young);
  const old = institutions.filter((i) => !i.young);

  /** A deposit that became active `ageDays` ago and matures `matureIn` days from today. */
  const activeDeposit = (inst: Inst, matureIn: number, opts: Partial<DepositOpts> = {}) => {
    const maturity = d(matureIn);
    const issue = plusYears(maturity, -5);
    const created = opts.created ?? minDate(d(10, issue), d(-30));
    return deposit({
      inst,
      bank: bankFor(inst),
      created,
      issue,
      maturity,
      amount: amountFor(inst),
      stage: 'ACTIVE',
      ...opts,
    });
  };

  /**
   * Renewal chain of `depth` deposits. The first matured `firstMaturedAgo` days ago; each renewal FDR
   * is issued ~50 days before its predecessor matures and declared a few days later.
   */
  const chain = (
    inst: Inst,
    depth: number,
    firstMaturedAgo: number,
    lastStage: Stage = 'ACTIVE',
  ) => {
    let maturity = d(-firstMaturedAgo);
    let issue = plusYears(maturity, -5);
    let created = d(-1900) > d(10, issue) ? d(-1900) : d(10, issue);
    let prev: Ref | undefined;
    for (let k = 0; k < depth; k++) {
      const stage = k === depth - 1 ? lastStage : 'ACTIVE';
      prev = deposit({
        inst,
        bank: bankFor(inst, k),
        created,
        issue,
        maturity,
        amount: amountFor(inst),
        stage,
        replaces: prev,
      });
      issue = d(-50, maturity);
      created = d(-45, maturity);
      maturity = plusYears(issue, 5);
    }
    return prev!;
  };

  // The two demo institutions get hand-picked stories.
  const [demo1, demo2] = [institutions[0]!, institutions[1]!];
  chain(demo1, 2, 1732); // renewed once; the current FDR matures in ~44 days → reminders, renewal demo
  deposit({
    inst: demo1,
    bank: 'SBIN',
    created: d(-2),
    issue: d(-5),
    maturity: plusYears(d(-5), 5),
    amount: 500_000,
    stage: 'DRAFT',
  });
  activeDeposit(demo2, 1240, { bank: 'HDFC' });
  // TRINETRA scenario (b): SBI stops reporting interest on this one in FY 2025-26.
  const prematureClosure = activeDeposit(demo2, 900, {
    bank: 'SBIN',
    created: d(-900),
    decl: { fdrNumber: 'SBI/FD/2024/880088' },
  });
  deposit({
    inst: demo2,
    bank: 'PUNB',
    created: d(-12),
    issue: d(-20),
    maturity: plusYears(d(-20), 5),
    amount: 500_000,
    stage: 'BANK_PENDING',
  });

  // Young institutions cycle through the lifecycle stories.
  const stories: ((i: Inst) => void)[] = [
    (i) => activeDeposit(i, 400 + Math.floor(rnd() * 1300)),
    (i) => activeDeposit(i, [12, 26, 48, 70, 85][i.index % 5]!), // expiring soon (30/60/90-day windows)
    (i) => chain(i, 2, 200 + Math.floor(rnd() * 1400)),
    (i) => activeDeposit(i, 500 + Math.floor(rnd() * 1100)),
    (i) => chain(i, 3, 1765 + Math.floor(rnd() * 30)),
    (i) => activeDeposit(i, -(5 + Math.floor(rnd() * 50))), // matured, not renewed → overdue
    (i) => {
      // Renewal in progress: current deposit expiring, replacement under scrutiny.
      const cur = activeDeposit(i, 20 + Math.floor(rnd() * 40));
      const issue = d(-6);
      deposit({
        inst: i,
        bank: deskBankFor(i, 1),
        created: d(-4),
        issue,
        maturity: plusYears(issue, 5),
        amount: amountFor(i),
        stage: 'SCRUTINY',
        replaces: cur,
      });
    },
    (i) => activeDeposit(i, 700 + Math.floor(rnd() * 900)),
    (i) => {
      // OCR read a different amount than declared → field mismatch under scrutiny.
      const issue = d(-25);
      deposit({
        inst: i,
        bank: deskBankFor(i),
        created: d(-18),
        issue,
        maturity: plusYears(issue, 5),
        amount: amountFor(i),
        stage: 'SCRUTINY',
        ocr: { amount: amountFor(i) / 10 },
      });
    },
    (i) => {
      // Officer raises a discrepancy and returns it to the institution.
      const issue = d(-40);
      const ref = deposit({
        inst: i,
        bank: deskBankFor(i),
        created: d(-30),
        issue,
        maturity: plusYears(issue, 5),
        amount: amountFor(i),
        stage: 'SCRUTINY',
        delays: { scrutiny: 2 },
      });
      tl.add(d(-25), i.id, 'raise discrepancy', async () => {
        await svc.discrepancies.raise(ro(i), ref.id!, {
          field: 'maturityDate',
          severity: 'MEDIUM',
          description: 'Maturity date on the scan is not legible; please upload a clearer copy.',
          returnToInstitution: true,
        });
      });
      if (i.index % 2 === 0) {
        tl.add(d(-20), i.id, 'institution responds', async () => {
          for (const x of await openDiscrepancies(ref.id!))
            await svc.discrepancies.comment(
              ip(i),
              x.id,
              'A clearer scan is attached; the maturity date is as declared.',
            );
          await svc.discrepancies.submitResponse(
            ip(i),
            ref.id!,
            'Clearer scan uploaded; maturity is as declared.',
          );
        });
      }
    },
    (i) => {
      // Waiting on a (desk) bank that has not answered within the SLA.
      const issue = d(-45);
      deposit({
        inst: i,
        bank: deskBankFor(i),
        created: d(-35),
        issue,
        maturity: plusYears(issue, 5),
        amount: amountFor(i),
        stage: 'BANK_PENDING',
        delays: { scrutiny: 2, verify: 3 },
      });
    },
    (i) => {
      // Bank denies the lien → back to scrutiny with a HIGH discrepancy.
      const issue = d(-60);
      const ref = deposit({
        inst: i,
        bank: deskBankFor(i),
        created: d(-50),
        issue,
        maturity: plusYears(issue, 5),
        amount: amountFor(i),
        stage: 'BANK_PENDING',
        delays: { scrutiny: 2, verify: 3 },
      });
      tl.add(d(-38), i.id, 'bank denies', async () => {
        await bankAnswer(ref, i, false);
      });
    },
    (i) => {
      // Submitted recently / long ago (scrutiny SLA breached).
      const created = i.index % 2 ? d(-3) : d(-21);
      deposit({
        inst: i,
        bank: bankFor(i),
        created,
        issue: d(-10, created),
        maturity: plusYears(d(-10, created), 5),
        amount: amountFor(i),
        stage: 'SUBMITTED',
      });
    },
    (i) => {
      // Rejected (not joint with AICTE), then declared again correctly and activated.
      const issue = d(-200);
      const bad = deposit({
        inst: i,
        bank: deskBankFor(i),
        created: d(-190),
        issue,
        maturity: plusYears(issue, 5),
        amount: amountFor(i),
        stage: 'SCRUTINY',
        decl: { depositorNames: [i.trustName.replace(' (fictional)', '').toUpperCase()] },
      });
      tl.add(d(-183), i.id, 'reject', async () => {
        await svc.scrutiny.reject(
          ro(i),
          bad.id!,
          'The FDR is not in the joint name of AICTE and the institution.',
        );
      });
      deposit({
        inst: i,
        bank: deskBankFor(i),
        created: d(-170),
        issue: d(-175),
        maturity: plusYears(d(-175), 5),
        amount: amountFor(i),
        stage: 'ACTIVE',
      });
    },
  ];
  // Every young institution gets one story; every other one also a second (e.g. an older deposit
  // alongside a new one under scrutiny), so the portfolio has ~150 deposits.
  young.slice(2).forEach((inst, k) => {
    stories[k % stories.length]!(inst);
    if (k % 2 === 0) stories[(k + 5) % stories.length]!(inst);
  });

  // Recent top-ups for newly approved programmes: drafts and fresh submissions in the queue.
  young.slice(2).forEach((inst, k) => {
    if (k % 4 !== 1 && k % 5 !== 2) return;
    const created = d(-1 - (k % 9));
    const issue = d(-3, created);
    deposit({
      inst,
      bank: deskBankFor(inst, 2),
      created,
      issue,
      maturity: plusYears(issue, 5),
      amount: 500_000,
      stage: k === 1 ? 'VERIFIED' : k % 4 === 1 ? 'DRAFT' : 'SUBMITTED',
    });
  });

  // A few young institutions also hold an extra (excess) deposit they are getting released.
  const releaseStages = [
    'REQUESTED',
    'RECOMMENDED',
    'APPROVED',
    'EXECUTED',
    'DECLINED',
    'REJECTED',
  ] as const;
  young
    .filter((i) => i.index > 2)
    .slice(0, releaseStages.length)
    .forEach((i, k) => {
      const issue = d(-900);
      const extra = deposit({
        inst: i,
        bank: bankFor(i, 3),
        created: d(-880),
        issue,
        maturity: plusYears(issue, 5),
        amount: 300_000,
        stage: 'ACTIVE',
      });
      release(extra, i, d(-30 + k * 3), releaseStages[k]!);
    });

  // Old (now exempt) institutions: deposits from their early years, released once they became
  // exempt (placeholder rule: 10+ years old). Some still hold one.
  const exemptAge = Number(rules['eligibility.exemption'].exemptIfAgeYearsAtLeast ?? 10);
  const kept: { ref: Ref; inst: Inst }[] = [];
  old.forEach((i, k) => {
    const exemptFrom = `${i.yearEstablished + exemptAge}-01-20`;
    const deposits = k % 3 === 0 ? 2 : 1;
    for (let n = 0; n < deposits; n++) {
      const issue = d(-1750 + k * 11 + n * 200);
      const ref = deposit({
        inst: i,
        bank: bankFor(i, n),
        created: d(10, issue),
        issue,
        maturity: plusYears(issue, 5),
        amount: 500_000,
        stage: 'ACTIVE',
      });
      if ((k + n) % 4 === 3) kept.push({ ref, inst: i });
      const proposed = d(-420 + k * 9 + n * 30);
      const at = exemptFrom > proposed ? exemptFrom : proposed;
      if ((k + n) % 4 !== 3 && at <= d(-20))
        release(ref, i, at, (k + n) % 5 === 1 ? 'APPROVED' : 'EXECUTED');
    }
  });

  // Fraud case: a second institution declares an FDR already held by another, with the same scan.
  const [victim, fraudster] = [young[3]!, young[young.length - 1]!];
  // TRINETRA scenario (c): a recycled document. Distinctive number so the demo can search for it.
  const original = activeDeposit(victim, 900, {
    bank: 'SBIN',
    created: d(-400),
    decl: { fdrNumber: 'SBI/FD/2025/770077' },
  });
  deposit({
    inst: fraudster,
    bank: 'SBIN',
    created: d(-6),
    issue: plusYears(d(900), -5),
    maturity: d(900),
    amount: amountFor(fraudster),
    stage: 'SCRUTINY',
    copyOf: original,
    decl: {
      depositorNames: ['AICTE', fraudster.trustName.replace(' (fictional)', '').toUpperCase()],
    },
    delays: { scrutiny: 1 },
  });

  // TRINETRA scenario (a): an altered amount. The receipt reads ₹2,50,000 but its printed maturity
  // value is what ₹25,00,000 would earn at 7 %: reverse maturity math gives it away.
  const nrYoung = young.filter((i) => i.regionCode === 'NR' && i.index > 2);
  {
    const issue = d(-12);
    const maturity = plusYears(issue, 5);
    deposit({
      inst: nrYoung[0]!,
      bank: 'SBIN',
      created: d(-8),
      issue,
      maturity,
      amount: 250_000,
      stage: 'SCRUTINY',
      decl: {
        fdrNumber: 'SBI/FD/2026/990250',
        interestRate: 7,
        maturityValue: Math.round(
          maturityValueFor(2_500_000, 7, tenureYears(issue, maturity), 'QUARTERLY'),
        ),
      },
      delays: { scrutiny: 2 },
    });
  }

  // Forfeiture: one invoked last quarter (full maker-checker trail), one awaiting a decision.
  if (kept[0]) {
    const { ref, inst } = kept[0];
    let fid = '';
    tl.add(d(-120), inst.id, 'forfeiture propose', async () => {
      fid = (
        await svc.forfeiture.propose(ro(inst), ref.id!, {
          reason: 'Approval withdrawn after inspection; the security deposit is to be invoked.',
          orderReference: `AICTE/${inst.regionCode}/FF/${d(-125).slice(0, 4)}/0007`,
        })
      ).id;
    });
    tl.add(d(-119), inst.id, 'reattest', async () => {
      await svc.bank.requestReattestation(
        ref.id!,
        'Re-verification before the forfeiture decision',
        ro(inst),
      );
    });
    tl.add(d(-118), inst.id, 'bank re-attests', async () => {
      const open = await prisma.bankConfirmationRequest.findFirst({
        where: { instrumentId: ref.id!, status: { in: ['PENDING', 'FAILED'] } },
      });
      if (open) await bankAnswer(ref, inst, true);
    });
    tl.add(d(-115), inst.id, 'forfeiture approve', async () => {
      await svc.forfeiture.approve(authority, fid, 'Approved; order upheld after hearing.');
    });
    tl.add(d(-110), inst.id, 'forfeiture execute', async () => {
      await svc.forfeiture.execute(finance, fid, {
        executionRef: `FIN/INV/${d(-110).slice(0, 4)}/0003`,
        executionDate: d(-110),
      });
    });
  }
  if (kept[1]) {
    const { ref, inst } = kept[1];
    tl.add(d(-4), inst.id, 'forfeiture propose', async () => {
      await svc.forfeiture.propose(bureau, ref.id!, {
        reason: 'Institution failed to replace a matured deposit despite notices.',
        orderReference: `AICTE/RB/FF/${T.slice(0, 4)}/0011`,
      });
    });
  }

  // Annual bank re-attestation of deposits active for more than a year (so most bank eyes are
  // fresh); three are left stale on purpose so the nightly job's scheduled re-attestation shows up.
  activeRefs.forEach(({ ref, inst, activeFrom }, k) => {
    if (k < 3 || activeFrom > d(-400)) return;
    const when = d(-60 - ((k * 37) % 240));
    tl.add(when, inst.id, 'annual re-attestation', async () => {
      const cur = await prisma.instrument.findUniqueOrThrow({
        where: { id: ref.id! },
        select: { status: true },
      });
      if (cur.status !== 'ACTIVE') return;
      await svc.bank.requestReattestation(ref.id!, 'Annual re-attestation', null);
    });
    tl.add(d(2, when), inst.id, 'bank re-attests', async () => {
      const open = await prisma.bankConfirmationRequest.findFirst({
        where: { instrumentId: ref.id!, status: { in: ['PENDING', 'FAILED'] } },
      });
      if (open) await bankAnswer(ref, inst, true);
    });
  });

  // TRINETRA tax eye: institutions upload their AIS for the last two financial years. Bank-reported
  // interest is generated from the deposits' own terms (fictional); for scenario (b) SBI stops
  // reporting on the demo institution's deposit in FY 2025-26.
  const uploadAis = (fy: string, when: string) =>
    tl.add(when, BARRIER, `AIS ${fy}`, async () => {
      const { start, endExclusive } = {
        start: `${fy.slice(0, 4)}-04-01`,
        endExclusive: `${Number(fy.slice(0, 4)) + 1}-04-01`,
      };
      const held = await prisma.instrument.findMany({
        where: {
          status: { in: [...HELD_STATES] },
          interestRate: { not: null },
          issueDate: { lt: new Date(`${endExclusive}T00:00:00Z`) },
          maturityDate: { gt: new Date(`${start}T00:00:00Z`) },
        },
        include: { bank: { select: { name: true, compounding: true } } },
      });
      const byInst = new Map<string, Map<string, number>>();
      for (const h of held) {
        if (!h.bank || !h.amount || !h.issueDate || !h.maturityDate) continue;
        if (fy === '2025-26' && h.id === prematureClosure.id) continue;
        const e = expectedInterestForFy({
          principal: Number(h.amount),
          ratePct: Number(h.interestRate),
          issueDate: h.issueDate.toISOString().slice(0, 10),
          maturityDate: h.maturityDate.toISOString().slice(0, 10),
          compounding: h.bank.compounding ?? 'QUARTERLY',
          fy,
        });
        const m = byInst.get(h.institutionId) ?? new Map<string, number>();
        m.set(h.bank.name.toUpperCase(), (m.get(h.bank.name.toUpperCase()) ?? 0) + e * 1.01);
        byInst.set(h.institutionId, m);
      }
      for (const [institutionId, banks] of byInst) {
        const user = instUser.get(institutionId);
        if (!user) continue;
        const json = {
          _note: 'FICTIONAL AIS generated by the demo seed (assumed layout)',
          assessee: { pan: 'AAATD0000D', name: 'FICTIONAL TRUST' },
          financialYear: fy,
          informationCategories: [
            {
              category: 'Interest from deposit',
              infoCode: 'SFT-016(TD)',
              entries: [...banks].map(([reportedBy, amount]) => ({
                reportedBy,
                amount: Math.round(amount * 100) / 100,
              })),
            },
          ],
        };
        const buffer = Buffer.from(JSON.stringify(json));
        await svc.tax.upload(user, { buffer, originalname: `ais-${fy}.json`, size: buffer.length });
      }
    });
  uploadAis('2024-25', '2025-07-10');
  uploadAis('2025-26', '2026-07-10');

  // Legacy digitisation (Northern Region): a batch of scans, some confirmed, some awaiting review,
  // one rejected, plus entries copied from the old paper register with no scan on file.
  const nr = institutions.filter((i) => i.regionCode === 'NR' && i.index > 2);
  const roNr = roByRegion.get(regions.find((r) => r.code === 'NR')!.id)!;
  tl.add(d(-15), BARRIER, 'legacy batch', async () => {
    const actor = actorOf(roNr);
    const batch = await prisma.legacyBatch.create({
      data: {
        regionId: roNr.regionId!,
        uploadedById: roNr.id,
        label: 'Record room — cupboard 3 (2019 files)',
        fileCount: 6,
        createdAt: svc.clock.now(),
      },
    });
    const items: { itemId: string; inst: Inst; decl: InstrumentDeclaration }[] = [];
    for (let k = 0; k < 6; k++) {
      const inst = nr[k % nr.length]!;
      const issue = d(-2400 + k * 40);
      const decl = declaration(inst, {
        bank: DESK_BANKS[k % DESK_BANKS.length]!,
        issue,
        maturity: plusYears(issue, k === 1 ? 4 : 5),
        amount: k === 2 ? 250_000 : 500_000,
      });
      const pdf = await fdrPdf({
        ...decl,
        bankName: BANK_STYLE[decl.bankCode]!.label,
        nonce: `LEGACY-${k}`,
      });
      const doc = await prisma.$transaction((tx) =>
        svc.documents.store(tx, {
          file: { buffer: pdf, originalname: `cupboard3-${k + 1}.pdf`, size: pdf.length },
          type: 'FDR_SCAN',
          instrumentId: null,
          institutionId: null,
          actor,
        }),
      );
      const fields = Object.fromEntries(
        declarationToAssertions(decl)
          .filter((a) => !['lienMarked', 'autoRenewal'].includes(a.field))
          .map((a) => [
            a.field,
            Array.isArray(a.value) ? (a.value as string[]).join('; ') : String(a.value),
          ]),
      ) as Partial<Record<FieldKey, string>>;
      if (k === 4) fields.amount = '50000.00'; // misread
      const preview: OcrPreview = {
        fields: { ...fields, amount: fields.amount ? Number(fields.amount).toFixed(2) : undefined },
        confidence: Object.fromEntries(
          Object.keys(fields).map((f) => [f, f === 'amount' && k === 4 ? 0.62 : 0.95]),
        ),
        lowConfidence: k === 4 ? ['amount'] : [],
        engine: 'rapidocr',
        rawText: '',
      };
      const item = await prisma.legacyItem.create({
        data: {
          batchId: batch.id,
          documentId: doc.id,
          fileName: `cupboard3-${k + 1}.pdf`,
          ocr: { ...preview },
          createdAt: svc.clock.now(),
        },
      });
      items.push({ itemId: item.id, inst, decl });
    }
    await svc.audit.record({
      actor,
      action: 'legacy.batch_uploaded',
      entityType: 'LegacyBatch',
      entityId: batch.id,
      data: { files: 6 },
    });
    // Confirm three, reject one, leave two for review.
    for (const it of items.slice(0, 3)) {
      await svc.legacy.confirm(roNr, it.itemId, {
        institutionId: it.inst.id,
        declaration: it.decl,
      });
    }
    await svc.legacy.reject(roNr, items[3]!.itemId, 'Photocopy of an FDR already on record.');
  });

  tl.add(d(-12), BARRIER, 'legacy register entries', async () => {
    // From the paper register; the physical FDRs could not be found (no scan) → missing document.
    for (const inst of nr.slice(3, 6)) {
      const issue = d(-2000);
      const decl = declaration(inst, {
        bank: 'SBIN',
        issue,
        maturity: plusYears(issue, 5),
        amount: 500_000,
      });
      const actor = actorOf(roNr);
      await prisma.$transaction(async (tx) => {
        const now = svc.clock.now();
        const refNo = await svc.instruments.nextRefNo(tx);
        const created = await tx.instrument.create({
          data: {
            refNo,
            type: 'FDR',
            institutionId: inst.id,
            branch: decl.branch,
            status: 'DRAFT',
            legacy: true,
            createdById: roNr.id,
            createdAt: now,
            statusChangedAt: now,
          },
        });
        await tx.statusTransition.create({
          data: {
            instrumentId: created.id,
            from: null,
            to: 'DRAFT',
            action: 'legacy_import',
            actorId: roNr.id,
            actorRole: 'RO_OFFICER',
            at: now,
          },
        });
        await svc.assertions.apply(
          tx,
          created.id,
          declarationToAssertions(decl, 'legacy register').map((a) => ({
            ...a,
            trust: 'OFFICER_VERIFIED' as const,
          })),
          actor,
        );
        const s = await svc.transitions.transition(
          tx,
          created,
          'SUBMITTED',
          actor,
          'Entered from the legacy register (physical FDR not found)',
        );
        await svc.transitions.transition(tx, s, 'UNDER_SCRUTINY', actor);
        await svc.instruments.afterChange(tx, created.id, actor);
      });
    }
  });

  // ─── Run ──────────────────────────────────────────────────────────────────
  tl.steps.sort((a, b) => (a.at === b.at ? a.seq - b.seq : a.at < b.at ? -1 : 1));
  const profile = new Map<string, number>();
  const queries = new Map<string, number>();
  const timed = async (label: string, fn: () => Promise<unknown>) => {
    const t0 = performance.now();
    const q0 = PrismaService.queryCount;
    await fn();
    profile.set(label, (profile.get(label) ?? 0) + performance.now() - t0);
    queries.set(label, (queries.get(label) ?? 0) + PrismaService.queryCount - q0);
  };
  const runStep = async (s: Step) => {
    try {
      await timed(s.label, s.run);
    } catch (e) {
      throw new Error(
        `Seed step "${s.label}" on ${s.at} failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  };
  const CONCURRENCY = Number(process.env.SEED_CONCURRENCY ?? 6);
  for (let i = 0; i < tl.steps.length;) {
    const day = tl.steps[i]!.at;
    const todays: Step[] = [];
    while (i < tl.steps.length && tl.steps[i]!.at === day) todays.push(tl.steps[i++]!);
    svc.clock.simulate(day);
    // Per-key queues run in parallel; barrier steps run alone afterwards.
    const queues = new Map<string, Step[]>();
    for (const s of todays)
      if (s.key !== BARRIER) queues.set(s.key, [...(queues.get(s.key) ?? []), s]);
    const pending = [...queues.values()];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
        for (let q = pending.shift(); q; q = pending.shift()) for (const s of q) await runStep(s);
      }),
    );
    for (const s of todays) if (s.key === BARRIER) await runStep(s);
  }
  svc.clock.simulate(null);
  svc.notifications.quietBefore = null;
  await prisma.systemSetting.delete({ where: { key: 'demo_clock' } }).catch(() => undefined);
  await svc.clock.sync(true);
  await timed('(lifecycle)', () => svc.lifecycle.run('seed'));
  if (process.env.SEED_PROFILE)
    console.table(
      [...profile]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ step: k, ms: Math.round(v), queries: queries.get(k) })),
    );

  const grouped = await prisma.instrument.groupBy({ by: ['status'], _count: true });
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count]));
  const total = grouped.reduce((n, g) => n + g._count, 0);
  const seconds = (Date.now() - started) / 1000;
  log(`✔ scenarios: ${total} instruments from ${tl.steps.length} steps in ${seconds.toFixed(1)}s`);
  log(
    `  ${Object.entries(byStatus)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`,
  );
  return { instruments: total, steps: tl.steps.length, seconds, byStatus };
}
