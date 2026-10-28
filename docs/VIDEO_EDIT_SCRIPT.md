# NidhiSetu demo video — complete edit script

**For:** the assistant helping edit this video, and the editor (person) doing the cuts.
**Team:** MAVERICKX · SIH 2026 · PS 26265 (AICTE) · "Streamline of Security Deposit / FDR Portal"

## 0. What the raw recording is

- One continuous screen recording, about **10–12 minutes**, of an automated walkthrough in a maximised
  Edge browser. Nobody touched the mouse; the site was driven by a script.
- A **white arrow cursor** glides to each control and an **orange ring pulses** on every click.
- A **dark caption bar** at the bottom centre names each step (bold title + grey sub-line). These captions
  are the most reliable way to find each scene — timestamps below are **estimates**, so locate cuts by the
  caption text.
- About **13 sign-in sequences** (email, password, 6-digit code) separate the role changes. They are the
  main thing to cut or speed up.
- All data on screen is **fictional** (demo environment banner at the top says so).

## 1. Deliverables

| Version | Length | Use |
|---|---|---|
| **A. Main demo** | **3:45–4:15** | Upload with the SIH submission / play to judges |
| **B. Short** | **~60–75 s** | Teaser for slide 2 or social |

Export both: **1920×1080, 30 fps, H.264, ~12 Mbps, AAC 192 kbps, MP4**. Keep a 4K master if the raw is 4K.

## 2. Global style rules

- **Speed:** sign-in sequences → cut to a 1.5 s "role card" (see §4) or speed up 6–8×. Waiting for OCR,
  uploads or page loads → speed up 3–4× or cut. Typing → 2× is fine.
- **Keep the burned-in captions** (they are part of the video). If you add your own titles, place them at
  the **top-left**, never over the bottom caption bar.
- **Zooms:** gentle 115–130 % push-ins on the area the cursor is acting on, 0.4 s ease-in/out. Never zoom
  while the page is scrolling.
- **Transitions:** straight cuts inside a scene; a 6-frame dip/cross-dissolve between scenes only.
- **Role cards:** a small pill top-left for 1.5 s whenever the user changes:
  `INSTITUTION`, `REGIONAL OFFICER`, `BANK DESK`, `REGULATION BUREAU`, `SYSTEM ADMIN`,
  `COMPETENT AUTHORITY`, `FINANCE`, `AUDITOR`. Colour: navy #0f2a5e background, white text.
- **Music:** soft corporate/tech, no vocals, **−22 to −26 dB under voice-over**, −14 dB when no voice.
  Fade in 1 s at start, fade out 2 s at end.
- **Voice-over:** calm, ~140 words/min, Indian English is ideal. Script in §5. Record at −16 LUFS
  integrated; final mix −14 LUFS, peaks below −1 dBTP.
- **Accuracy rule:** show and say only what the video shows. Do not add graphics claiming features that do
  not appear on screen (see §7).

## 3. Scene map of the raw recording (find by caption text)

Approximate raw times assume a ~11-minute recording; adjust to your file.

| # | Raw ≈ | On-screen caption (exact title) | What happens | Keep in Main | Treatment |
|---|---|---|---|---|---|
| 0 | 0:00–0:07 | **NidhiSetu** — "One verifiable record for every AICTE security deposit…" | Login screen | ✅ 5 s | Hold, add title card overlay (§4) |
| 1a | 0:07–0:17 | "Signing in as an Institution" | Typing credentials | ❌ | Replace with role card |
| 1b | 0:17–0:27 | **Institution dashboard** | Dashboard + scroll | ✅ 4 s | Speed scroll 2× |
| 1c | 0:27–0:50 | **Scenario 1 · New FDR submission** → "OCR filled every field from the scan" | Scan uploaded, form fills itself | ✅ 10 s | Cut OCR wait; zoom on filled fields |
| 1d | 0:50–1:15 | "Draft saved — every value is recorded with its source" → **Submitted to the Regional Office** | Save, upload, submit | ✅ 8 s | Speed 2×, zoom on badges |
| 2a | 1:15–1:25 | "Signing in as the Regional Officer…" | Login | ❌ | Role card |
| 2b | 1:25–2:05 | **Scrutiny queue** → **Scrutiny workspace** → "Every field now officer-verified" → **Sent to State Bank of India…** | Scan beside fields, verify all, send to bank | ✅ 18 s | Zoom on scan + badges turning amber |
| 3 | 2:05–2:45 | **Bank Confirmation Desk** → "The bank checks its own records" → **Bank confirmed → the deposit is ACTIVE** | Bank officer confirms | ✅ 12 s | Cut login; zoom on "Confirm all" |
| 4 | 2:45–3:15 | **Bank-confirmed values turn green** | Institution view, green badges, trust score | ✅ 7 s | Zoom on trust score + green badges |
| 5 | 3:15–3:55 | **Scenario 5 · Discrepancy identification** → "Reverse maturity math flags a likely altered amount" → "All discrepancies in one queue" | ₹2,50,000 receipt vs ₹25 lakh maturity value | ✅ 15 s | **Hero moment** — zoom on the discrepancy text |
| 6 | 3:55–4:40 | **National dashboard** → "Fraud signal: the same FDR declared by two institutions" → "Duplicate FDR + recycled scan detected" | Bureau dashboard, duplicate FDR | ✅ 14 s | Zoom on red fraud banner, then on the flagged record |
| 7 | 4:40–5:40 | **Scenarios 2 & 3 · Validity tracking and approaching maturity** → "30 days later…" → "Maturity reminders arrive automatically" → "Validity status on every deposit" | Demo clock +30 days, reminders, validity | ✅ 16 s | Zoom on "+30 days" click and on reminder list |
| 8 | 5:40–6:50 | **Scenario 4 · Renewal** → **Renewal chain linked** | Replacement FDR filed, chain shown | ✅ 14 s | Speed typing 3×; end on the chain |
| 9 | 6:50–7:30 | **Configurable rules engine** | Admin resets clock, rules page | ✅ 5 s | Keep only the rules page (cut clock reset) |
| 10 | 7:30–9:10 | **Scenario 6 · Authorised release processing** → "Preconditions checked automatically" → "Recommended (maker)" → "Approved (checker)" → **Released — NidhiSetu records the discharge…** | Request blocked by checklist; another goes recommend → approve → finance | ✅ 30 s | Cut 3 logins to role cards; zoom on checklist ✗/✓, then on the release timeline |
| 11 | 9:10–9:35 | **Legacy digitisation** | Legacy batch + reconciliation | ✅ 6 s | Speed scroll 2× |
| 12 | 9:35–10:15 | **Outcome metrics from the audit trail** → **Escalations** → **Management reports** | Metrics, escalations, reports | ✅ 10 s | ⚠ see §7 — crop/cover the two metric cards showing raw text keys |
| 13 | 10:15–10:45 | **Tamper-evident audit trail** → "Chain intact — and anchored with a signed checkpoint" | Verify audit chain → green | ✅ 8 s | Zoom on green "Chain intact" box |
| 14 | 10:45–11:05 | "हिन्दी में पूरा पोर्टल" | Switch to Hindi and back | ✅ 4 s | Keep the Hindi frame only |
| 15 | 11:05–11:15 | **NidhiSetu** — "Verifiable deposits · automated tracking…" | Closing caption | ✅ 4 s | Then end card (§4) |

Target total for the Main version ≈ 3:55 including title and end cards.

## 4. Graphics to add

1. **Opening title (0:00–0:05)**, over scene 0:
   - "NidhiSetu" — large, white, bold
   - "A self-verifying lifecycle portal for AICTE security deposits & FDRs"
   - Small line: "Team MAVERICKX · SIH 2026 · PS 26265 · Smart Automation"
2. **Scenario chips** (top-left, 2 s) matching the PS's six test scenarios, at scenes 1c, 7, 7 (second
   half), 8, 5, 10:
   `PS SCENARIO 1 · New FDR submission` · `2 · Validity tracking` · `3 · Approaching maturity` ·
   `4 · Renewal` · `5 · Discrepancy identification` · `6 · Authorised release`
3. **Role cards** (§2) at every role change.
4. **Provenance legend** (scene 1d or 4, 3 s, bottom-right above the caption bar):
   Grey = Declared · Blue = OCR · Amber = Officer-verified · Green = Bank-confirmed.
5. **End card (last 6 s):**
   - "Every FDR proven, not presumed."
   - "6/6 PS test scenarios · 10/10 PS capabilities · English + हिन्दी"
   - "github.com/knightspan/NIDHI-SETU"
   - "Team MAVERICKX · All data shown is fictional"

## 5. Voice-over script (Main version, ~3:50)

Lines are timed to the scene list; trim pauses to fit.

**[Title]** "This is NidhiSetu — one verifiable record for every security deposit AICTE holds, from submission to release."

**[1 · Institution]** "An institution submits a new FDR. It uploads the scan, and OCR reads the receipt and fills in the form. Every value is stored with its source, so declared data is never confused with verified data."

**[2 · Regional officer]** "The regional officer sees only their region's queue. The original scan sits beside the declared values; the officer verifies each field and sends the deposit to the bank."

**[3 · Bank]** "The bank confirms from its own records — existence, lien in favour of AICTE, maturity and auto-renewal — through a simple desk, with no integration needed on day one."

**[4 · Institution]** "Bank-confirmed fields turn green, and the trust score rises."

**[5 · Discrepancy]** "Now a forged receipt. It shows two lakh fifty thousand rupees, but its printed maturity value only adds up for twenty-five lakh. NidhiSetu recomputes the interest, catches the altered amount and raises a high-severity discrepancy automatically."

**[6 · Fraud]** "At the national level, the Regulation Bureau sees everything AICTE holds — and a fraud alert: the same FDR, with the same scan, declared by two different institutions."

**[7 · Time]** "Validity is tracked automatically. Moving the demo clock thirty days forward, the nightly job re-checks every deposit, sends maturity reminders and escalates anything overdue."

**[8 · Renewal]** "The institution renews its expiring FDR. The old and new deposits are linked in a chain, and the old one stays held until the new one is confirmed."

**[9 · Rules]** "Amounts, exemptions and reminder windows are configurable, versioned rules — not code."

**[10 · Release]** "Release is strictly controlled. A request that does not meet the preconditions is blocked. A valid one is recommended by one officer and approved by a different authority — maker-checker — and only after a fresh bank re-confirmation. Finance records the discharge; NidhiSetu never moves money."

**[11 · Legacy]** "Physical FDRs in Regional Office lockers are bulk-digitised, and a reconciliation report shows what is missing, expired or duplicated."

**[12 · Metrics]** "Outcome metrics like verification turnaround and renewal timeliness are computed directly from the audit trail, with escalations and exportable reports."

**[13 · Audit]** "Every action is hash-chained. The auditor verifies the chain — intact, and anchored with a signed checkpoint, so even a rewrite of history would be caught."

**[14 · Hindi]** "The entire portal works in English and Hindi."

**[End]** "NidhiSetu. Every FDR proven, not presumed."

## 6. Short version (~60–75 s)

Use only: Title (3 s) → 1c OCR fill (6 s) → 2b scan beside fields (6 s) → 3 bank confirm → green (6 s) →
5 altered amount caught (10 s) → 6 fraud banner (6 s) → 7 reminders after +30 days (6 s) → 10 approve +
released (10 s) → 13 chain intact (5 s) → 14 Hindi (3 s) → End card (5 s).
Voice-over: one sentence per beat from §5, or music only with the burned-in captions.

## 7. Things to handle carefully

- **Metrics page (scene 12):** two cards ("manual effort" metrics) show raw text such as
  `metrics.names.manual_edits_per_instrument` because their labels were missing at recording time. **Crop
  them out, blur them, or cut that shot short.** Keep the other cards (verification turnaround, renewals,
  release time, discrepancy ageing, % bank-confirmed).
- **Do not claim on screen** what the video does not show. The TRINETRA tax "heartbeat" chart, the three eye
  cards and the forfeiture screens are **not in this recording** (they exist in the backend only). The
  altered-amount and duplicate-FDR detections shown are real and may be labelled "TRINETRA · document check".
- **Sign-in screens** show demo emails; fine to keep briefly, but don't hold on them.
- Keep the yellow "Demo environment · all data is fictional" banner visible — it protects the team.

## 8. Instructions for the assistant

The editor will tell you which tool they use (e.g. CapCut, Clipchamp, DaVinci Resolve, Premiere, or
ffmpeg). Then:

1. Ask them to scrub the raw file and give you the **actual start/end timestamp of each caption** in §3.
2. Produce an exact **cut list** (in/out points, speed factors, zoom keyframes) for the Main and Short
   versions, adjusted to those real timestamps and the target lengths in §1.
3. Give step-by-step instructions for their tool (or ready-to-run ffmpeg commands with `trim`, `setpts`
   for speed, `crop`/`scale` for zooms, `drawtext` or image overlays for cards, and an `amix` music bed).
4. Re-time the voice-over lines in §5 to the final cut and flag any line that no longer fits.
5. Check the final cut against §7 before export.
