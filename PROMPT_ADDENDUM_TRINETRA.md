ADDENDUM: TRINETRA verification + FDR Heartbeat (build as Phase 5b; don't restart finished phases; update docs/PLAN.md)

1. TRINETRA — store each check as a VerificationSignal row:
   instrument_id, eye (BANK | TAX | DOCUMENT), result (PASS | FAIL | STALE | NOT_AVAILABLE),
   details_json, evidence_document_id, checked_at, valid_until

BANK eye: the existing Bank Confirmation Desk + adapter. A confirmation becomes STALE after N months
(rule; seed 12, label ASSUMPTION).

DOCUMENT eye — three pure functions with unit tests:
a) Maturity-math test: recompute maturity value from principal, rate, tenure, compounding
(quarterly default, configurable per bank). FAIL if it differs from the printed/declared value
beyond a configurable tolerance. Also reverse-infer: if the printed maturity value matches a
different principal (e.g. 10x the OCR amount), say so in details_json (catches altered amounts).
b) IFSC check: validate format, look up in a local IFSC master table (seed a small fictional set,
document how to load the full master); the branch on the FDR must match the IFSC record.
c) Duplicate check: flag the same (bank, FDR number) or the same document SHA-256 under more than
one instrument or institution.

TAX eye ("FDR Heartbeat"):

- The institution uploads its AIS JSON (downloaded from the Income Tax e-filing portal) per FY.
  Parse it with an isolated, pluggable parser; test with a fictional sample in fixtures/ais/.
- Extract "interest from deposit" amounts per reporting bank.
- For each ACTIVE FDR, compute expected interest for that FY; sum expected per bank and compare
  with the bank-reported interest.
- PASS if reported >= expected x (1 - tolerance); FAIL ("trail broken") if materially lower or
  missing; NOT_AVAILABLE if no AIS uploaded.
- AIS is corroboration only. A Tax FAIL never auto-rejects. It must: create a HIGH discrepancy,
  auto-create a fresh bank confirmation request, and lock release and renewal until the bank re-attests.
- Yearly job (plus a demo-clock-aware manual trigger) requests the new FY's AIS and escalates if
  it isn't uploaded within the SLA.

2. Trust score 0-100 per instrument from field provenance levels, the three eyes' latest results
   and signal age; weights in the rules table. Show the score, three eye cards (Bank / Tax /
   Document) and an annual heartbeat strip on the instrument page.

3. Release gate: RELEASE_RECOMMENDED -> RELEASE_APPROVED requires a bank PASS newer than N days
   (rule), no open HIGH discrepancies, and a Tax eye not FAIL for the latest FY. Enforce in the
   state machine, not the UI.

4. Seed + Playwright tests + docs/DEMO.md for three scenarios:
   (a) altered amount: OCR principal Rs 2,50,000 but printed maturity value matches Rs 25,00,000
   (b) premature closure: bank stops reporting interest in the latest FY -> heartbeat FAIL, release locked
   (c) recycled document: same FDR number submitted by two institutions

5. docs/KNOWN_LIMITATIONS.md: AIS interest is bank-wise per PAN, not per FDR; joint-holder
   reporting depends on the bank; the AIS parser schema is an assumption until validated with real
   AIS JSON; Account Aggregator term-deposit feeds are roadmap only (AICTE is not a regulated FIU,
   and non-individual term deposits aren't live on AA yet).
