# Security

NidhiSetu records and tracks security deposits; it never moves money. The main risks are therefore
**tampering with records** (a deposit shown as active when it isn't, a release approved by the wrong
person), **unauthorised disclosure** (scans, bank details, personal data) and **account takeover**.
This document lists the controls and where they live in the code.

## 1. Authentication

| Control            | Detail                                                                                                                                                                                       | Where                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Password hashing   | argon2id; a dummy hash is checked for unknown emails so response time doesn't reveal which accounts exist                                                                                    | `apps/api/src/auth/auth.service.ts`                              |
| Lockout            | 5 failed logins lock the account for 15 minutes; failures are audited with the email masked                                                                                                  | `auth.service.ts`                                                |
| MFA                | TOTP (RFC 6238) required for every officer role, and for institutions too whenever `DEMO_MODE=false` (`MFA_REQUIRED_ALL_ROLES`); secrets AES-256-GCM encrypted                               | `auth.service.ts`, `config/config.ts`                            |
| Sessions           | Short-lived access JWT (15 min) + refresh token (8 h) in **httpOnly** cookies; refresh tokens are stored hashed and rotated on every use; logout revokes                                     | `auth/cookies.ts`, `auth.controller.ts`                          |
| Brute-force limits | 10 login / MFA attempts per minute per IP **and account** (an office behind one public IP cannot lock itself out), on top of the lockout                                                     | `common/throttler.guard.ts`                                      |
| Passwords          | ≥ 12 characters with a letter and a digit; users change their own (all sessions revoked); admins issue one-time temporary passwords that must be replaced before any other request is served | `auth.service.ts`, `admin/users.controller.ts`, `auth/guards.ts` |

In the demo (`DEMO_MODE=true`) institution accounts sign in with a password only, so the walkthrough
stays short; outside demo mode they need an authenticator like everyone else.

## 2. Authorisation

- **Default deny.** A global guard rejects any route without an explicit `@RequirePermission(...)`,
  `@AuthenticatedOnly()` or `@Public()` decorator, so a forgotten annotation fails closed.
- **Permissions by role** are defined once in `packages/shared/src/permissions.ts` and used by both the
  API and the UI (the UI only hides what the API would refuse anyway).
- **Scoping in the query, not after it.** Every instrument / document / discrepancy query is built with
  `instrumentScope(principal)` (`apps/api/src/domain/scope.ts`): institutions see their own records,
  regional officers their region, bank officers only instruments at their bank. Out-of-scope records
  return **404**, so IDs can't be probed.
- **State machine.** Every status change goes through `assertTransition` in `packages/shared`; the API
  computes `allowedActions` per user and record, and refuses anything else with 409.
- **Maker–checker** on releases: the officer who recommends cannot approve, and the approver cannot
  execute (`apps/api/src/releases`).

## 3. Integrity and audit

- **Hash-chained audit log.** Every state-changing action writes an `audit_events` row whose hash is
  `sha256(previousHash + canonicalJson(event))`, serialised with a Postgres advisory lock.
- **Append-only at the database level.** Triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on
  `audit_events` (migration `audit_append_only`), so even the application's own DB user can't rewrite
  history. `POST /api/audit/verify` recomputes the chain and reports the first broken link.
- **Signed anchors.** A database superuser could edit an event and recompute every later hash. To catch
  that, the nightly job signs the chain head with `AUDIT_ANCHOR_KEY` (held outside the database,
  required in production), stores the anchor in the append-only `audit_anchors` table and sends it to
  the auditors. Verification checks every anchor; a recomputed chain no longer matches them
  (`pnpm tamper` demonstrates both attacks).
- **UTC sessions.** Database connections run with `TimeZone=UTC`, so stored instants are correct
  whatever the server's zone (raw SQL, reports and backups see the true time).
- **Field provenance.** Values are never overwritten: each is an assertion with its source and trust
  level (declared → OCR → officer-verified → bank-confirmed), so a later edit can't silently replace
  what the bank confirmed.

## 4. Documents

- Uploads are checked by **magic bytes** (PDF, PNG, JPEG only), size-limited, and stored with a
  SHA-256 digest (duplicate scans across institutions raise a discrepancy).
- Files are **encrypted at rest** with AES-256-GCM (random IV per file) before they reach disk or the
  object store; the key is `DOCUMENT_ENCRYPTION_KEY`.
- Downloads use **short-lived signed URLs** (5 minutes) issued only after the scope check, and every
  download is audited. Responses carry `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.

## 5. Web and API hardening

- **CSRF:** double-submit token (`ns_csrf` cookie echoed in `x-csrf-token`) on every state-changing
  request, plus `SameSite` cookies; login and MFA verification are the only exemptions.
- **Same origin:** the browser only talks to the Next.js origin; `/api` is proxied, so auth cookies are
  first-party and CORS is restricted to `WEB_ORIGIN`.
- **Headers:** helmet on the API (CSP, frame-ancestors, CORP); the web app sends a strict CSP and HSTS in
  production, plus `X-Frame-Options: DENY`, `Referrer-Policy` and a restrictive `Permissions-Policy`.
- **Input validation:** every body, query and path parameter is parsed with a zod schema shared with the
  UI; unknown fields are dropped. Errors never include stack traces or SQL.
- **Rate limits:** 120 requests/minute per client by default (`RATE_LIMIT_PER_MINUTE`), with tighter
  limits on login (10), OCR preview (20), report exports (20), document uploads (30) and legacy batch
  uploads (10).

## 6. Logging and PII

All API logs pass through `MaskingLogger` (`apps/api/src/common/pii.ts`), which masks email addresses,
Indian mobile numbers, long account-like digit runs and bearer / signed-URL tokens before anything is
written. Audit payloads store masked emails for failed logins. See [DPDP.md](DPDP.md).

## 7. Secrets and configuration

- No secrets in the repository. `.env.example` lists every variable; the API refuses to start if a
  secret is missing or too short (validated with zod in `apps/api/src/config/config.ts`).
- Integration credentials (banks, AICTE portal, SMS gateway) belong in the deployment's secret store and
  are never written to the database.

## 8. Verifying the controls

| What                                 | How                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| RBAC and scoping per endpoint        | `apps/api/test/rbac-admin.test.ts` and the scoping cases in each integration test                                   |
| Audit chain and tamper detection     | `apps/api/test/audit.test.ts`; `pnpm tamper` (Phase 11) breaks a row and shows `POST /api/audit/verify` catching it |
| CSRF, lockout, MFA, refresh rotation | `apps/api/test/auth.test.ts`                                                                                        |
| PII masking                          | `apps/api/src/common/pii.test.ts`                                                                                   |
| Accessibility                        | axe-core (WCAG 2.1 AA) over every page per role; Lighthouse accessibility 100 on the login page                     |

## 9. Reporting a vulnerability

This is a hackathon prototype. Please report issues privately to the team rather than opening a public
issue.
