# Decision Log

Each entry: context → decision → consequences. Newest last.

---

### D-001 · Pin TypeScript 6.0.x, not 7.x (2026-10-26)

**Context:** TypeScript 7.0 (native Go compiler) is the npm `latest`, but `typescript-eslint` 8.72 supports only
`>=4.8.4 <6.1.0`, and `@nestjs/cli` 12 bundles `~6.0.2`.
**Decision:** Pin `typescript@~6.0.3` across the monorepo.
**Consequences:** Type-aware linting works. Revisit once typescript-eslint supports TS 7.

### D-002 · Pin Prisma 7.10.1 (stable), not 8.0 RC (2026-10-26)

**Context:** The `prisma` package's `latest` dist-tag points to `8.0.0-rc.27`; `@prisma/client` latest is 7.10.1.
**Decision:** Use Prisma 7.10.1 (CLI + client + `@prisma/adapter-pg`) with the `prisma-client` generator and
`prisma.config.ts`.
**Consequences:** No release-candidate code in a judged demo.

### D-003 · ESM throughout the TypeScript monorepo (2026-10-26)

**Context:** NestJS 12 packages are ESM-only (`"type": "module"`).
**Decision:** All TS workspaces are ESM with `module/moduleResolution: NodeNext` (web uses `Bundler`). Relative
imports carry `.js` extensions. API tests run in Vitest with `unplugin-swc`, because esbuild does not emit the
decorator metadata NestJS DI needs.
**Consequences:** One module system everywhere; `@nidhisetu/shared` is consumed from its built `dist/`
(Turborepo builds it first).

### D-004 · RustFS instead of MinIO as the dev S3 store (2026-10-26)

**Context:** The brief asks for MinIO with server-side encryption. `minio/minio` no longer exists on Docker Hub
(404) or Quay, since MinIO stopped publishing community builds.
**Decision:** Use `rustfs/rustfs:1.0.4` (Apache-2.0, S3-compatible, actively released) as the `objectstore`
service. The API talks plain S3 (AWS SDK), so any S3-compatible store, including a self-built MinIO, works.
**Consequences:** See D-005 for encryption at rest.

### D-005 · Application-level encryption of documents (2026-10-26)

**Context:** Server-side encryption depends on the object store's KMS setup, which differs per product.
**Decision:** The API encrypts every document with AES-256-GCM (key from `DOCUMENT_ENCRYPTION_KEY`, random
96-bit IV per object, auth tag stored with metadata) before upload. sha256 is computed on the plaintext for
integrity and duplicate detection.
**Consequences:** Encryption at rest holds even with a misconfigured bucket; the object store never sees
plaintext. Key rotation is a documented limitation (re-encrypt job).

### D-006 · `docker-compose.yml` at repo root; infra config under `infra/` (2026-10-26)

**Decision:** Keep the compose file at the root so `docker compose up` works with no flags. `infra/` holds
supporting config (Postgres init SQL creates a separate `nidhisetu_test` database).

### D-007 · Compose works without a `.env` (2026-10-26)

**Decision:** Every compose variable has a dev default (`${VAR:-default}`). `.env.example` documents all of them.
**Consequences:** One-command start on a fresh machine. Dev secrets are clearly labelled and must be overridden
for any non-local deployment.

### D-008 · pnpm 12 build-script allow-list (2026-10-26)

**Context:** pnpm blocks dependency install scripts unless allowed.
**Decision:** Explicit `allowBuilds` list in `pnpm-workspace.yaml` (swc, prisma, argon2, sharp, esbuild,
msgpackr-extract, unrs-resolver).

### D-009 · Next.js standalone output only in Docker (2026-10-26)

**Context:** Standalone output creates deep symlink trees that exceed Windows path limits during local builds.
**Decision:** `output: 'standalone'` is enabled only when `NEXT_OUTPUT=standalone` (set in the web Dockerfile).

### D-010 · OCR service on Python 3.12 in Docker; `httpx2` for tests (2026-10-26)

**Decision:** The container uses Python 3.12 because OCR engine wheels lag new CPython releases. Starlette's
test client now recommends `httpx2`, so dev dependencies use it.

### D-011 · Docker-free local stack for development (2026-10-26)

**Context:** The main dev machine has no Docker and no admin rights to install it. Phase 1 onward needs
PostgreSQL and Redis for migrations and integration tests.
**Decision:** `scripts/local-stack.mjs` (`pnpm stack:up | stack:down | stack:status`) runs portable
PostgreSQL 16.14 (`@embedded-postgres/*` binaries, as optional deps so only the matching OS installs), Redis
8.8.3 (`redis-windows` msys2 build) and Mailpit 1.32 on the same ports and credentials as
`docker-compose.yml`. Data lives in the git-ignored `.data/` folder.
**Consequences:** Development and tests work without Docker. Docker Compose remains the supported way to run
the full demo; the Dockerfiles are validated in CI (`docker compose config`) rather than on this machine.

### D-012 · Three extra lifecycle transitions (2026-10-26)

**Context:** The brief's state machine has no exit when a bank denies a confirmation, when a renewal's
replacement is rejected, or when an officer declines to recommend a release.
**Decision:** Add `BANK_CONFIRMATION_PENDING → UNDER_SCRUTINY` (bank denied/contradicted),
`RENEWAL_PENDING → ACTIVE` (replacement rejected) and `RELEASE_REQUESTED → RELEASE_REJECTED` (officer
declines). `RELEASE_REJECTED → ACTIVE` happens automatically in the same transaction, so the instrument
never rests in RELEASE_REJECTED; the rejection stays on the release request and in the transition log.
**Consequences:** Every state stays reachable and every non-terminal state has an exit (unit-tested).

### D-013 · Cookie auth + double-submit CSRF, same-origin proxy (2026-10-26)

**Decision:** Access (15 min) and refresh (8 h, rotating, single use, stored hashed) tokens live in
httpOnly SameSite=Lax cookies. Every state-changing request must echo the readable `ns_csrf` cookie in
`x-csrf-token`. The browser only talks to the Next.js origin, which proxies `/api/*` to NestJS, so cookies
are first-party.

### D-014 · SYS_ADMIN sees no financial records (2026-10-26)

**Decision:** The admin's data scope is `NONE`: users, rules, master data, demo clock and audit
verification only. Least privilege, and it backs the brief's rule that the admin cannot approve releases.

### D-015 · Default-deny authorisation (2026-10-26)

**Decision:** A global guard refuses any non-public route that does not declare `@RequirePermission(...)` or
`@AuthenticatedOnly()`, so a forgotten annotation fails closed.

### D-016 · Integration tests on a dedicated `*_test` database (2026-10-26)

**Decision:** The integration suite drops and re-migrates the `public` schema of a database whose name must
end in `_test` (checked before anything runs). Each test file builds its own isolated fixture (unique
regions, banks, institutions and users), so files never depend on each other.

### D-017 · Demo TOTP secrets are deterministic (2026-10-26)

**Decision:** Demo accounts get TOTP secrets derived from their email, printed by `pnpm seed`, and
`pnpm demo:otp <email>` prints the current code, so judges can sign in without a phone. Real accounts
always get random secrets through enrolment.

### D-018 · Notification outbox (2026-10-27)

**Decision:** Notifications are rows written in the same transaction as the business change; emails are
sent afterwards from an outbox (`emailStatus` PENDING → SENT/FAILED) by a debounced in-process flush and
a once-a-minute BullMQ job. A rolled-back action never emails anyone, and SMTP outages only delay mail.

### D-019 · Reminders after a clock jump (2026-10-27)

**Decision:** When the (demo) clock crosses several reminder offsets at once, every crossed offset is
recorded (keeping the one-per-offset guarantee) but only the nearest is announced, so nobody gets four
emails for one instrument on the same day.

### D-020 · Escalation ladder pacing (2026-10-27)

**Decision:** An item escalates to ladder level 1 when its SLA is missed and one level further per
additional SLA period. Items with a 0-day SLA (overdue renewals) escalate immediately and then weekly.

### D-021 · BullMQ needs a constructed ioredis client under ESM (2026-10-27)

**Context:** BullMQ 6 treats `ioredis` as optional and cannot load it from connection options in native ESM.
**Decision:** Depend on `ioredis` directly and pass a constructed client (`maxRetriesPerRequest: null`).
Without Redis (or with `QUEUE_ENABLED=false`) the same jobs run from admin endpoints.

### D-022 · OCR engine: PP-OCR models through RapidOCR (2026-10-27)

**Context:** The brief asks for PaddleOCR with a Tesseract fallback. The PaddlePaddle wheels are large
(~1 GB with dependencies) and not available for every Python/OS combination we target.
**Decision:** The OCR service runs the same PP-OCR detection/recognition models through RapidOCR on
ONNX Runtime (bundled models, CPU only). If `paddleocr` is installed (`requirements-paddle.txt`) it is
preferred; Tesseract is the last fallback. `/health` reports the engine in use. Field extraction is
rule-based and deterministic; an LLM pass is optional and off by default.
**Consequence:** OCR output is only ever recorded at `OCR_EXTRACTED` trust and never auto-promoted; the
API treats an unreachable OCR service as "no OCR" so uploads never fail because of it.

### D-023 · Legacy records enter at scrutiny, not active (2026-10-27)

**Decision:** Confirming a legacy scan creates a `legacy` instrument with OCR_EXTRACTED (scan) and
OFFICER_VERIFIED (officer's reading of the physical original) assertions and moves it straight to
UNDER_SCRUTINY. It still needs bank confirmation like any other deposit; digitisation alone never makes a
record ACTIVE. Disagreements between the scan and the officer's values surface as mismatches.

### D-024 · Retention never deletes automatically (2026-10-27)

**Decision:** `RETENTION_YEARS_CLOSED_RECORDS` (placeholder 8 years — ASSUMPTION, verify against AICTE
policy) only drives a review list (`GET /api/admin/retention`). Purging financial evidence is a legal
decision, and the audit log is append-only by design, so the system never deletes on a timer.

### D-025 · Web CSP keeps `'unsafe-inline'` for scripts (2026-10-27)

**Context:** Next.js inlines its bootstrap scripts; a nonce-based CSP forces every page to render
dynamically. **Decision:** Production CSP allows inline scripts but restricts every source to the
portal's own origin (no third-party scripts, `frame-ancestors 'none'`, `object-src 'none'`). Moving to
nonces is listed in KNOWN_LIMITATIONS.

### D-026 · Signed audit anchors (2026-10-27)

**Context:** A hash chain alone only proves internal consistency; anyone able to rewrite the table can
recompute it. **Decision:** Sign the chain head daily with an HMAC key kept outside the database
(`AUDIT_ANCHOR_KEY`), store anchors append-only and email them to auditors. **Consequence:** edits to
anything older than the last anchor are detectable even after a full rewrite; events since the last
anchor are protected by the chain and triggers only. Anchoring hourly, or to an external timestamping
service, is on the roadmap.

### D-027 · Database sessions in UTC (2026-10-27)

**Context:** Prisma's pg driver adapter exchanges timestamps without a zone; on a server whose time zone
is not UTC every stored instant was shifted by the offset (consistent through Prisma, wrong for raw SQL).
**Decision:** All Prisma connections set `TimeZone=UTC`.

### D-028 · Temporary passwords block everything but the password change (2026-10-27)

**Decision:** An admin reset issues a random one-time password shown once (never stored or logged in
clear), revokes sessions and sets `mustChangePassword`; the permission guard refuses every route except
the profile and password change until the user picks their own password.
