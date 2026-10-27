# Personal data and the DPDP Act

How NidhiSetu handles personal data under the Digital Personal Data Protection Act, 2023 and the DPDP
Rules, 2025. This is an engineering note for a prototype, not legal advice: periods and duties marked
**ASSUMPTION** must be confirmed by AICTE's legal team before production use.

## 1. What personal data the system holds

Most of the data is about **institutions and deposits**, which are not personal data. Personal data
appears in a few places:

| Data                                           | Whose                                                           | Why it is needed                                    | Where stored                        |
| ---------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| Name, email, role, region / institution / bank | Portal users (officials)                                        | Sign-in, permissions, notifications, accountability | `users`                             |
| TOTP secret (encrypted)                        | Officers                                                        | Multi-factor authentication                         | `users.mfaSecretEnc`                |
| IP address and browser user-agent per action   | Portal users                                                    | Audit trail and fraud investigation                 | `audit_events`                      |
| Contact email and phone of the institution     | Institution's contact person                                    | Reminders and notices about the deposit             | `institutions`                      |
| Depositor names on the FDR                     | Usually the trust / society; occasionally an individual trustee | Checking the deposit is jointly held with AICTE     | field assertions                    |
| Scanned FDRs, NOCs, bank letters               | May show signatures or names                                    | Evidence for verification                           | object store, AES-256-GCM encrypted |

The system does **not** collect Aadhaar, PAN, bank account numbers of individuals, or any payment data.
Demo data is entirely fictional.

## 2. Principles applied

- **Purpose limitation.** Data is used only to verify and track security deposits. Notification emails
  carry the reference and the action needed, not document contents.
- **Data minimisation.** Logs never contain full emails, phone numbers, account-like numbers or tokens
  (`MaskingLogger`, `apps/api/src/common/pii.ts`). Failed-login audit entries store a masked email.
  OCR runs on our own service; the optional LLM extraction pass is **off by default**
  (`LLM_EXTRACTION=false`) so scan text does not leave the deployment unless AICTE decides otherwise.
- **Security safeguards** (Section 8(5) of the Act): encryption at rest for documents and MFA secrets,
  short-lived signed download links, role- and scope-based access, an append-only hash-chained audit
  log. See [SECURITY.md](SECURITY.md).
- **Accuracy.** Every value keeps its source and trust level; corrections are new assertions, so the
  history of who said what is never lost.

## 3. Retention

| Record                                                               | Retention                                                                                         | Setting                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| Closed instruments (released, renewed, rejected) and their documents | **8 years** after closure — **ASSUMPTION – verify against AICTE record-retention policy and GFR** | `RETENTION_YEARS_CLOSED_RECORDS` |
| Audit log                                                            | Kept for the life of the system; it is the evidence trail and is append-only by design            | —                                |
| Sessions / refresh tokens                                            | Expire after 8 hours; revoked on logout                                                           | `JWT_REFRESH_TTL_SECONDS`        |
| Signed download links                                                | 5 minutes                                                                                         | `DOCUMENT_URL_TTL_SECONDS`       |
| Deactivated user accounts                                            | Kept (deactivated, cannot sign in) so audit entries stay attributable                             | —                                |

`GET /api/admin/retention` (auditor / admin) lists closed records past the retention period. Nothing
is deleted automatically: archival or erasure is a deliberate, recorded decision, because financial
records may be under other legal holds.

## 4. Rights of data principals

| Right (DPDP Act)                    | How it is met                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Information about processing (s.11) | Users can see their profile and the actions recorded against their name in the audit viewer (via an auditor)                 |
| Correction and erasure (s.12)       | Admins correct user and institution details; erasure of records still within retention is refused with reasons, and recorded |
| Grievance redressal (s.13)          | Through AICTE's existing grievance officer; contact details belong on the login page in production                           |

## 5. Personal data breach

If a breach is suspected:

1. Contain: deactivate affected accounts (takes effect on the next request), rotate `JWT_*` secrets
   (signs everyone out) and, if documents are involved, rotate storage credentials.
2. Investigate with the audit log: every view, download and change is recorded with user, IP and time,
   and `POST /api/audit/verify` shows whether the trail itself was tampered with.
3. Notify the Data Protection Board and affected people as the DPDP Rules require (initial intimation
   without delay, detailed report within 72 hours — **ASSUMPTION – confirm current Rules**).

## 6. Processors and transfers

| Processor                                 | Data shared                   | Note                                                              |
| ----------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| SMTP provider                             | User email, notification text | Use a government / NIC relay in production                        |
| SMS gateway (stub today)                  | Phone number, short notice    | DLT-registered Indian gateway                                     |
| Anthropic (only if `LLM_EXTRACTION=true`) | OCR text of a scan            | Off by default; enabling it is a data-transfer decision for AICTE |

All other processing (database, object store, OCR) runs inside the deployment.
