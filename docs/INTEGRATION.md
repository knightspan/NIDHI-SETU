# Integration Guide

NidhiSetu talks to the outside world only through adapter interfaces. Each ships with a mock, so the demo
runs offline, and each can be swapped for a real integration without touching domain logic.

| Adapter               | Interface                 | Implementations today                                 | File                                         |
| --------------------- | ------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| Bank verification     | `BankVerificationAdapter` | `BankDeskAdapter` (manual desk), `MockBankApiAdapter` | `apps/api/src/bank/bank-adapters.ts`         |
| AICTE approval portal | `AicteApprovalAdapter`    | `MockAicteApprovalAdapter`                            | `apps/api/src/integrations/aicte.adapter.ts` |
| SMS                   | `SmsAdapter`              | `StubSmsAdapter` (logs)                               | `apps/api/src/notifications/sms.adapter.ts`  |
| OCR                   | HTTP `POST /extract`      | FastAPI service (`services/ocr`)                      | `apps/api/src/ocr/ocr.client.ts`             |
| Object storage        | `StorageAdapter`          | `FsStorageAdapter`, `S3StorageAdapter`                | `apps/api/src/storage/storage.adapter.ts`    |

All APIs are described by OpenAPI at **`/api/docs`** (JSON at `/api/docs/openapi.json`).

---

## 1. Bank confirmation

### What AICTE asks

For each instrument, AICTE asks the issuing bank to confirm or deny **four things**, plus the principal:

1. the FDR exists (bank + FDR number),
2. a lien is marked in favour of AICTE,
3. the maturity date,
4. the auto-renewal status,
5. _(optional)_ the principal amount.

### The contract

```ts
interface BankConfirmationQuery {
  requestId: string; // idempotency key — the bank must treat retries of the same id as one request
  bankCode: string; // IFSC bank prefix, e.g. "SBIN"
  fdrNumber: string;
  ifsc: string | null;
  amount: string | null; // what AICTE holds, so the bank can flag differences
  maturityDate: string | null;
  depositorNames: string | null;
}

type BankSubmitResult =
  | { kind: 'pending' } // answer arrives later (desk / async API)
  | { kind: 'answered'; response: BankResponse; reference: string };

interface BankResponse {
  exists: boolean;
  lienMarked: boolean | null;
  maturityDate: string | null; // YYYY-MM-DD
  autoRenewal: boolean | null;
  amount?: number | null;
  remarks?: string;
  reference?: string; // bank's own reference for the confirmation
}
```

Errors are thrown as `BankApiError(message, retryable)`. Retryable failures mark the request `FAILED`; the
regional officer can retry it from the instrument page (and the escalation job flags requests past their SLA).

### How a response is applied (`BankService.applyResponse`)

- Every value the bank states becomes a **`BANK_CONFIRMED` assertion** (with the signed letter, if any, as evidence).
- If the FDR exists, the lien is marked and nothing contradicts AICTE's values → `BANK_CONFIRMED → ACTIVE`.
- Otherwise a **HIGH `BANK_DENIED` discrepancy** lists each contradiction, and the instrument goes back to
  `UNDER_SCRUTINY`. The discrepancy engine also raises `FIELD_MISMATCH` / `LIEN_NOT_MARKED` findings.

### Channels

`BANK_ADAPTER` selects the channel:

| Value            | Behaviour                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `desk`           | Every bank answers on the Bank Confirmation Desk (bank officers log in, see only their bank's queue). |
| `mock-api`       | Every bank answers through the simulated API.                                                         |
| `auto` (default) | Banks flagged `apiEnabled` in the bank master use the API; others use the desk.                       |

The mock API (`MOCK_BANK_API_LATENCY_MS`, `MOCK_BANK_API_FAILURE_RATE`) behaves like an honest ledger, except
for fictional demo "trap" FDR numbers: `…NOTFOUND…` (no such deposit), `…NOLIEN…` (lien not marked),
`…EARLY…` (maturity one year earlier).

### Plugging in a real bank API

1. Implement `BankVerificationAdapter` (e.g. `SbiBankApiAdapter`) — call the bank's lien-enquiry / deposit
   enquiry API with mutual TLS, map its response to `BankResponse`, throw `BankApiError` on timeouts.
2. Add the bank's credentials to configuration (never to the database), and register the adapter in
   `BankService.adapterFor()` keyed by bank code.
3. For asynchronous banks, return `{ kind: 'pending' }` and expose a signed webhook that calls
   `BankService.applyResponse()` with the bank as actor; verify the bank's signature on every callback.
4. Keep the `requestId` as the idempotency key in both directions.

### Plugging in an NeSL-style registry

An information utility (e.g. a registry where banks record deposits under lien) replaces per-bank integration:

- implement one `RegistryAdapter implements BankVerificationAdapter` that queries the registry by
  (bank, FDR number) and returns the registered lien holder, maturity and status;
- treat "lien holder = AICTE" as `lienMarked: true`;
- registry confirmations should be recorded with `source: 'registry'` so the audit trail shows provenance;
- registry change notifications (lien release, premature closure) can feed a new `instrument.bank_event`
  audit action and raise a HIGH discrepancy automatically.

---

## 2. AICTE approval portal

`AicteApprovalAdapter.fetchInstitution(applicationId)` returns the institution master (name, trust, region,
programmes, year of establishment). The mock reads fictional data; a real implementation would call the
approval portal's API (or a nightly extract) and is used to pre-fill and periodically refresh `Institution`
rows, so required-amount rules always use current programmes.

`GET /api/integrations/aicte/:aicteId` (SYS_ADMIN) fetches the portal record and lists the fields where
it differs from the local master (programmes compared as a set). The mock mirrors the local data and
reports an extra programme for AICTE IDs ending in 7, to demonstrate drift detection.

## 3. Notifications

Email goes through SMTP (Mailpit in development). SMS uses `SmsAdapter`; the stub logs messages with the
phone number masked. A DLT-registered SMS gateway is a drop-in implementation.

## 4. OCR

The API sends an uploaded FDR scan to the OCR service (`POST /extract`) and records the returned fields as
`OCR_EXTRACTED` assertions. OCR output can never rise above that trust level — an officer or the bank must
confirm it. See `services/ocr/README.md`.

## 5. Security of integrations

- Outbound credentials live in environment/secret stores only; nothing is stored in the database.
- Every integration call that changes data is written to the hash-chained audit log with its source.
- Inbound callbacks (future) must be authenticated (mTLS or signed payloads) and idempotent.
