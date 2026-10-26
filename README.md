# NidhiSetu

**Verifiable Security Deposit / FDR Lifecycle Portal** — Smart India Hackathon 2026, PS **SIH26265**
(AICTE, Ministry of Education · Smart Automation · Software).

NidhiSetu gives AICTE one trusted record of every security deposit / Fixed Deposit Receipt: who declared each
value, who verified it, and whether the bank confirmed it. It then tracks each instrument through
validity, renewal and release. It records and verifies money; it never moves money.

> 🚧 Under active development. See [docs/PLAN.md](docs/PLAN.md) for the architecture and phase checklist, and
> [docs/DECISIONS.md](docs/DECISIONS.md) for design decisions.

## Quick start

Prerequisites: Docker (with Compose v2.24+), Node.js ≥ 22.12, pnpm 12.

```bash
docker compose up --build      # postgres, redis, object store, mailpit, ocr, api, web
pnpm install && pnpm seed      # seed fictional demo data (available from Phase 11)
```

| Service              | URL                              |
| -------------------- | -------------------------------- |
| Web app              | http://localhost:3000            |
| API health           | http://localhost:4000/api/health |
| Mailpit (dev email)  | http://localhost:8025            |
| Object store console | http://localhost:9001            |
| OCR service          | http://localhost:8000/health     |

## Development

```bash
pnpm install
pnpm build        # builds shared → api → web
pnpm dev          # watch mode for all TS workspaces
pnpm lint && pnpm typecheck && pnpm test
```

OCR service (Python 3.12+):

```bash
cd services/ocr
python -m venv .venv && .venv/Scripts/activate   # or: source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q && ruff check .
```

## Repository layout

| Path              | What                                           |
| ----------------- | ---------------------------------------------- |
| `apps/api`        | NestJS API (Prisma, BullMQ, auth, RBAC, audit) |
| `apps/web`        | Next.js web app (en / hi)                      |
| `packages/shared` | zod schemas, enums, lifecycle state machine    |
| `services/ocr`    | FastAPI OCR + field extraction                 |
| `infra`           | Supporting infrastructure config               |
| `docs`            | Plan, decisions, security, DPDP, demo script   |

All data in this repository is fictional.
