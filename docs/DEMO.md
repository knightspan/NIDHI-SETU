# Demo walkthrough (≈10 minutes)

A guided path through the six problem-statement scenarios on the seeded demo data. Start from a fresh
portfolio with `pnpm demo:reset` (about 30 s). Password for every account: **`NidhiSetu@2026`**.
Officers need a TOTP code: `pnpm demo:otp <email>`.

Everything shown is fictional. The yellow banner at the top of every page shows the simulated "today".

## 1. The institution's view — validity and an approaching maturity (2 min)

Sign in as **`institution@demo.nidhisetu.local`**.

- **Dashboard**: the institution's held deposit, its validity and the required amount (from the rules
  table — placeholders marked _ASSUMPTION_).
- **Notifications**: a reminder that its current FDR matures in ~44 days (the 60-day reminder).
- **Instruments → the "Expiring soon" deposit**: every key field shows _where its value came from_
  (Declared → OCR extracted → Officer verified → Bank confirmed). Expand a row to see each assertion,
  who made it and the scan it came from. The **renewal chain** shows the FDR it replaced.
- Click **Submit renewal / replacement** to file the new FDR (scenario 4). The old deposit stays held
  until the bank confirms the new one.

Switch to **हिन्दी** in the header at any point; every screen is translated.

## 2. A new FDR, pre-filled from its scan (2 min)

Still as the institution, open **New FDR** and use **Upload scan to pre-fill** with
`services/ocr/samples/sample-01.jpg` (needs the OCR service). The form fills itself; uncertain values
are highlighted in amber. Save the draft — the scan is attached and the OCR values are recorded as
evidence — then **Submit for scrutiny** (scenario 1).

## 3. Scrutiny and discrepancies — the regional officer (2 min)

Sign in as **`ro.north@demo.nidhisetu.local`**.

- **Scrutiny queue**: the FDR you just submitted, plus seeded ones (some past their SLA).
- Open it → **Begin scrutiny**. The workspace shows the original scan beside the values. **Verify**
  fields, or **Correct…** one: a disagreement with the declaration raises a _Source mismatch_
  discrepancy automatically (scenario 5). Other automatic rules: amount below requirement, maturity too
  early, not in joint name, lien not marked, invalid IFSC, unknown bank, missing scan, duplicate FDR,
  duplicate scan.
- **Raise discrepancy** to send questions back to the institution; or verify everything and **Send to
  bank**.

## 4. Bank confirmation (1 min)

Sign in as **`bank.sbi@demo.nidhisetu.local`** → **Bank desk**. Each request shows only what AICTE holds
about one FDR at this bank. Confirm existence, lien, maturity and auto-renewal. A confirmation activates
the deposit; a denial sends it back to scrutiny with a HIGH discrepancy. (HDFC and ICICI answer through
the mock bank API instantly.)

## 5. Oversight, fraud signal and release (2 min)

Sign in as **`bureau@demo.nidhisetu.local`**.

- **Dashboard**: the red **Duplicate-FDR fraud signals** banner — two institutions declared the same FDR
  number at the same bank with the same scan. Open it to see both records linked.
- Validity mix, deposits by status, region and bank; every chart has a table view.
- **Releases** (scenario 6): open a request marked _All preconditions met_ and **Recommend** it. Then
  sign in as **`authority@demo.nidhisetu.local`** to **Approve release** (the recommender cannot), and
  as **`finance@demo.nidhisetu.local`** to **Record execution** with the reference of the discharge done
  outside the portal. NidhiSetu never moves money.
- **Outcome metrics**: verification turnaround, renewals before maturity, release processing time,
  discrepancy ageing — computed from the audit trail.

## 6. Time travel — reminders and escalations (1 min)

Sign in as **`admin@demo.nidhisetu.local`** → **Demo clock** → **+30 days** (or set a date). The
lifecycle job runs: validity changes, the next reminders go out (see them in Mailpit at
http://localhost:8025 when email is enabled) and items past their SLA climb the escalation ladder
(RO → bureau → competent authority). **Reset to real date** when done (scenarios 2 and 3).

## 7. Tamper evidence (1 min)

Sign in as **`auditor@demo.nidhisetu.local`** → **Audit** → **Verify audit chain**: every event since the
first is hashed into the next. Then in a terminal:

```bash
pnpm tamper
```

It shows the database refusing an ordinary edit of an audit row, then simulates an insider who
disables the protection and edits one event — the chain check pinpoints the altered event. It then
recomputes every later hash so the chain looks consistent again, and the daily **signed anchor** (whose
key is not in the database) still exposes the rewrite. Run
**Verify audit chain** again in the browser to see the break. `pnpm demo:reset` restores a clean chain.

## 8. Legacy records (optional, 1 min)

As **`ro.north@demo.nidhisetu.local`** → **Legacy digitisation**: the batch "Record room — cupboard 3"
has scans awaiting review (OCR drafts beside the image, institution suggested from the depositor
names). Upload more scans or a ZIP. The **Reconciliation** report lists institutions with no deposit on
record, expired and mismatched legacy deposits, duplicates and unreviewed scans, and exports to CSV.
