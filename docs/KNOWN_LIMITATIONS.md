# Known limitations and roadmap

NidhiSetu is a hackathon prototype. This page records what a demanding reviewer would criticise, what
was fixed after our own harsh review, and what still has to happen before a pilot.

## 1. Self-review: ten weaknesses a judge would raise

We reviewed the finished build as a sceptical SIH judge would. The five most serious were fixed; the
other five need people, partners or time rather than code.

| #   | Weakness                                                                                                                                                             | Status                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The audit chain could be rewritten whole.** A database superuser could edit an event and recompute every later hash; the chain would verify.                       | **Fixed.** Daily signed anchors with a key held outside the database, append-only anchor table, copies emailed to auditors. `pnpm tamper` shows the rewrite being caught. Residual risk: events since the last anchor (≤ 1 day). |
| 2   | **No password lifecycle.** Users could not change their password; an admin set it and knew it; no reset.                                                             | **Fixed.** Self-service change (≥ 12 chars, letter + digit, all sessions revoked); admin one-time temporary password that blocks everything until replaced.                                                                      |
| 3   | **Institutions signed in with a password only**, yet they make the declarations.                                                                                     | **Fixed.** `MFA_REQUIRED_ALL_ROLES`, on by default outside demo mode.                                                                                                                                                            |
| 4   | **Duplicate-FDR detection was exact-match.** `1O4211` (letter O) or different separators slipped past.                                                               | **Fixed.** Canonical key folding case, separators and OCR look-alikes (O/0, I/L/1, S/5, B/8, Z/2), with a backfill migration.                                                                                                    |
| 5   | **Scale of everyday screens unproven.** Only the nightly job had been load-tested.                                                                                   | **Fixed (measured).** At 10 000 deposits: dashboard 0.2 s, lists and search < 50 ms, metrics 20 ms, Excel export ≈ 1 s; all in `pnpm load-test`.                                                                                 |
| 6   | **Bank confirmation is simulated.** A desk for bank officers plus a mock API; no bank has agreed to either.                                                          | Open — needs bank partners (see roadmap).                                                                                                                                                                                        |
| 7   | **Every regulatory value is a placeholder** (amounts, tenure, exemption age, reminder windows, SLAs).                                                                | Open — needs AICTE to confirm against the Approval Process Handbook; all values are in the versioned rules table, marked `ASSUMPTION`.                                                                                           |
| 8   | **OCR is proven only on 10 synthetic scans** (70/70 fields).                                                                                                         | Open — real receipts (stamps, handwriting, skew, photocopies) are untested. Mitigations: OCR never rises above "OCR extracted", low-confidence values are highlighted, an officer verifies every field.                          |
| 9   | **Accessibility and Hindi are machine-checked only.** axe (0 violations) and Lighthouse (100) on every page; no screen-reader users or official translator involved. | Open — needs a GIGW / WCAG audit with assistive-technology users and Rajbhasha review of the Hindi strings.                                                                                                                      |
| 10  | **The web CSP allows inline scripts** (Next.js bootstrap).                                                                                                           | Open — move to nonce-based CSP (forces dynamic rendering; see D-025).                                                                                                                                                            |

While fixing #1 we also found and fixed a real bug: on a database server outside UTC, every stored
timestamp was shifted by the server's offset (invisible through the app, wrong for raw SQL, reports and
backups). Connections now run in UTC (D-027).

## 2. Other limitations

- **Operations.** The scheduled jobs run inside one API instance (BullMQ, Redis). There is no
  high-availability setup, backup / restore runbook or monitoring stack yet.
- **Notifications.** SMS is a logging stub; email deliverability (SPF/DKIM, a government relay) is not
  configured.
- **Onboarding.** Institutions and users are created by an administrator; the AICTE approval-portal
  adapter is a mock that mirrors local data.
- **Rules granularity.** The exemption rule compares calendar years of establishment, not exact dates.
- **No money movement — by design.** Release execution records a reference to a discharge done outside
  the portal; there is no reconciliation with the bank's actual release of lien.
- **Testing gaps.** The end-to-end suite needs a running stack and is not part of CI; there is no
  HTTP-level load test with many concurrent users. One integration-test failure in the admin RBAC suite
  was seen once and could not be reproduced in later runs.
- **Demo shortcuts.** `DEMO_MODE` enables the demo clock, password-only institution sign-in and the
  `pnpm tamper` script; all are off when `DEMO_MODE=false`.

## 3. Roadmap

**Before a pilot (0–3 months)**

1. AICTE confirms every rule value; the `ASSUMPTION` labels are replaced with handbook references.
2. Pilot with two banks: either the bank-desk workflow or a lien-enquiry API, plus a signed
   confirmation letter format.
3. Hosting on government cloud with backups, restore drills, monitoring and an SMS gateway with DLT
   templates.
4. Independent security audit (CERT-In empanelled auditor) and a GIGW / WCAG 2.1 AA audit with
   assistive-technology users; official review of the Hindi strings.
5. OCR evaluation on a few hundred real (anonymised) receipts; tune the extraction rules.

**Integrations (3–6 months)**

- Live AICTE approval-portal adapter: institution master and programme changes flow in automatically.
- Bank APIs for confirmation and lien-release events; explore electronic bank guarantees for
  institutions that use guarantees instead of FDRs.
- Single sign-on for AICTE officers.

**Scale and assurance (6–12 months)**

- Hourly audit anchors and an external timestamping or transparency log, so even the last day of
  events is protected against a full rewrite.
- Nonce-based CSP; read replicas for reports; multi-instance job scheduling.
- Analytics on renewal behaviour to predict which deposits are likely to lapse.
