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
