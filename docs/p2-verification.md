# P2 aggregate settlement verification

2026-10-22: P2.1–P2.4 implemented and locally tested. P2.5 real payment completed; current evidence is [p2-live-evidence.json](p2-live-evidence.json). P0 and P1 historical evidence is unchanged. No P3 console or Render deployment is included.

## Implementation

- Immutable whole-charge batches: server-selected single merchant, checked integer USD sum, sorted allocation hash, owner replay and unique charge allocation. Batching changes no balance.
- Provider-neutral port over the existing Sandbox OAuth/Orders transport. API JSON and approval URLs are validated; only Sandbox HTTPS checkout links are returned. One order purchase unit carries the batch UUID in custom_id and invoice_id.
- Durable attempt with distinct create/capture keys, exact stored input/callback URLs, first-attempt timestamps and bounded counters. Request keys and first timestamps cannot rotate. Every network mutation is preceded by committed intent; no remote call occurs inside a SQLite transaction.
- Three-minute renewable database lease, cancellation latch, versioned resume, one-time hashed callback state bound to batch/order. A redirect never captures or settles. A cancellation after capture intent cannot guarantee no remote payment; independent GET records the actual outcome.
- Fresh authenticated GET must match order, batch/invoice, receiver, gross USD total and exactly one full COMPLETED capture. Atomic finalization appends one confirmation plus one settlement event per charge, changes allocations to SETTLED, restores account availability and creates one immutable receipt. Task lifetime spending remains unchanged.
- Startup/30-second recovery only inspects known unpaid orders. It never automatically creates or captures. Owner retry of ambiguous create uses the same persisted input/key. Maximum three logical mutations, each transport capped at three attempts; five-hour cutoff from first intent. A longer Retry-After persists next_attempt_at and yields. Unknown/expired/cancelled charges remain allocated and outstanding.
- Owner correction reverses a whole unallocated unpaid charge once, with a reason/audit, and restores account/task projections. Allocated/settled charges cannot be corrected or rebilled. No allocation release, webhook, AUTHORIZE, void/refund API, payouts or split settlement exists.

Migrations 6/7 preserve prior ledger IDs, hashes, amounts and timestamps. Version 7 rebuilds constrained tables inside one migration transaction with FK enforcement temporarily disabled outside the transaction, checks all foreign keys before commit, then enables enforcement. v1/v4/v5 history and an allocated v6 upgrade are tested. Back up local state before migration; never activate two independent copies of a payment database.

## Local commands

The existing server-only `.env` provides PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MERCHANT_ID and OWNER_TOKEN. Existing HOST/PORT/PUBLIC_URL control loopback serving/callbacks. Optional CREDENCE_DB_PATH selects the economic database; server default is DATA_DIR/credence.sqlite. No new secret or runtime dependency is needed.

```sh
# Inspect existing accepted charges. Do not delete state or replay procurement to reset spending.
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite pnpm economy status
# Only an explicit selection of whole accepted charge IDs is allowed.
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite pnpm economy freeze ACCOUNT_ID FREEZE_KEY CHARGE_ID_1 CHARGE_ID_2 CHARGE_ID_3

# Keep this loopback process running while the Personal buyer approves on PayPal.
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite PORT=3001 PUBLIC_URL=http://localhost:3001 pnpm dev

# In another terminal, use matching database/origin configuration.
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite PORT=3001 PUBLIC_URL=http://localhost:3001 pnpm settlement order BATCH_ID ORDER_REQUEST_KEY
# Open returned approvalUrl, log in as a different Sandbox Personal buyer and approve USD 7.50.
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite PORT=3001 PUBLIC_URL=http://localhost:3001 pnpm settlement capture BATCH_ID CAPTURE_REQUEST_KEY
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite pnpm settlement reconcile BATCH_ID RECONCILE_KEY
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite pnpm verify:phase2 BATCH_ID
# Once SETTLED, checkpoint, gracefully stop/start the same server/database, then verify its HTTP API.
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite PORT=3001 PUBLIC_URL=http://localhost:3001 pnpm verify:phase2 BATCH_ID --checkpoint-restart
# Restart the server, then:
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite PORT=3001 PUBLIC_URL=http://localhost:3001 pnpm verify:phase2 BATCH_ID --after-restart
```

The CLI trusts filesystem access as owner authority. `pnpm settlement status`, `recover`, `cancel BATCH_ID KEY`, `resume BATCH_ID KEY` and `reverse CHARGE_ID "owner correction reason"` are also implemented. Resume requires the original order to be APPROVED; it does not capture. Reusing an applied resume key cannot clear a later cancellation. No resume exists for cancellation before any order; safe allocation release remains deferred.

`verify:phase2` is opt-in. It independently reads PayPal, validates the frozen mapping, and only when a receipt already exists replays order/capture entry points and checks the receipt and financial counts are unchanged. It writes sanitized evidence and exits nonzero for an incomplete live gate. Restart checkpoints are explicitly prepared with --checkpoint-restart and validated against the running owner API with --after-restart. It never initiates payment for an unpaid batch. Missing credentials/approval are reported, not replaced with success.

## Owner HTTP interface

Default fixed-bill endpoints return 410. P0 regression remains `pnpm dev:phase0` with its isolated JSON ledger, explicit port/origin and historical verification command; do not run it to pay runtime charges.

| Request | Body | Behavior |
| --- | --- | --- |
| GET /api/economy | — | Safe balances and charge metadata |
| GET /api/batches or /api/batches/:id | — | Batch, allocations, safe status/IDs and immutable receipt |
| POST /api/batches | accountId, chargeIds | Freeze full charges; never accepts total/merchant |
| POST /api/batches/:id/order | {} | Persist/replay the same order attempt, return approval URL |
| POST /api/batches/:id/capture | expectedVersion | Inspect approval, persist intent, capture, independently inspect |
| POST /api/batches/:id/cancel | expectedVersion | Latch cancellation; not a remote refund |
| POST /api/batches/:id/resume | expectedVersion | Explicit approved-order resume; separate capture required |
| POST /api/batches/:id/reconcile | {} | Fresh authoritative inspection, including after settlement |

All owner routes require Bearer OWNER_TOKEN, exact Host and any supplied Origin. POST requires Content-Type application/json and Idempotency-Key; body limit 8 KiB, exact fields only. New stale versions conflict; exact repeated commands replay. HTTP 202 indicates unresolved/pending state. Single-owner context comes from persisted accounts, not client actor fields. No browser session exists in P2; P3 must add sessions/CSRF before its UI. Payment request keys, callback state/hash, credentials and raw payer data are absent from API views.

## Local automated evidence

Run `pnpm check`, `pnpm test`, `pnpm test:production` (includes build), `git diff --check`. HTTP tests require localhost port permission; the restricted environment's EPERM is a test-environment failure, and the permitted run is the recorded result. Unit/integration tests use real SQLite and mocked provider/model/PayPal responses, not live money.

Coverage includes three real application-code accepted charge allocations; invalid/rejected/foreign/duplicate selections; changed request payload; cross-process allocation and confirmation races; exact request replay; partial/multiple/wrong-amount/currency/merchant/order/batch/invoice responses; OAuth retries and Retry-After; pending/decline/unknown; success POST without authoritative GET success; cancel before and after capture intent; callback forgery/replay; expired mutation window and bounded attempts; failed writes at each finalization checkpoint; reversal rollback; actual worker process exit after durable capture intent; stale lease recovery; close/reopen; migration history preservation; projection/event/receipt reconciliation; secret-safe owner API; compiled runtime restart.

## Real Sandbox evidence and limits

The gate reuses the three real accepted P1 purchases from task `6a131fa3-6968-40a6-9896-441b7f22d22e` (inventory 125, architecture 250, risk 375). No new model call or replacement obligation was created. Verification ledger was backed up before migration. Original exhausted P1 ledger, P0 settlement JSON and their evidence remain unchanged.

Batch: `b83897ec-f208-47a1-8e41-e9f38c0566ae`; order: `9PU44438P3941414W`; capture: `44G16685B65499710`; gross USD 7.50. Buyer explicitly confirmed approval in this chat. Backend Capture and independent authenticated GET established COMPLETED. A real graceful server restart and repeated owner HTTP order/capture/reconcile requests preserved the original receipt, verified-at timestamp and financial counts. One confirmation and three charge-settlement events restore this account to limit 1,500 / reserved 0 / outstanding 0 / available 1,500. Its task lifetime spending stays 750 and model request count stays five.

The recorded gate proves one real three-service batch/payment, not five consecutive demonstrations, true buyer funding failure, live capture-time packet loss, power-loss durability or refund correctness. Negative/crash/race cases are local tests; P0's injected decline remains separate historical evidence. P3/P4 are not authorized by P2 completion.

PayPal supplies OAuth, buyer checkout/approval, Orders/Capture and bounded request-ID idempotency; internal Credit, service delivery checks, aggregation, allocation uniqueness, financial events, recovery decisions and effective-once local accounting are Credence code. Sources checked 2026-10-22: [Orders v2](https://developer.paypal.com/api/orders/v2), [request idempotency](https://developer.paypal.com/api/rest/reference/idempotency/), [create-order key retention](https://developer.paypal.com/sdk/orders/v2/orders-create/), [HTTP responses and ambiguous capture](https://developer.paypal.com/api/rest/responses/). The five-hour cutoff is an internal conservative policy below the documented six-hour default; it is not unlimited PayPal deduplication.

Final local validation: `pnpm check`; `pnpm test` **94/94**; `pnpm test:production` (compiled build, health, archived P0 route and SQLite restart); `git diff --check`. Changed-file scanning found no configured Client Secret, owner token, LLM key or GitHub token values; `.env` remains untracked.
