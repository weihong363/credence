# ADR 0011: durable owner-approved Sandbox settlement

Accepted 2026-10-22, owner authorized completion of P2.

## Decision

Default server routes real accepted-charge batches through `Payments` and the provider-neutral `PaymentPort`. `PayPalAdapter` alone translates Orders v2 JSON; it reuses the P0 OAuth/retry transport. Default fixed-bill endpoints return HTTP 410. `pnpm dev:phase0` is the explicit historical regression entry point and uses only P0 JSON obligations. No fixture charge is imported into SQLite.

Migration 7 adds persistent attempt keys, exact create input, independent observations, owner command replay and immutable receipts. Migration table rebuilds follow SQLite's FK-off migration pattern: disable enforcement before BEGIN IMMEDIATE, rebuild/copy, run foreign_key_check before commit, then enable enforcement before returning the connection. Existing history and triggers remain covered by v1/v4/v5/v6 upgrade tests. Application transactions always use FK enforcement.

Create and capture intent commit before network mutation. Three-minute renewable DB leases serialize payment operations across processes. Cancellation commits independently and blocks a later capture intent; a POST already in flight must be reconciled. Callback state is single-use, hashed and bound to batch/order; it can latch cancellation or schedule inspection, never capture or establish settlement. Resume requires a distinct explicit owner command and authoritative approval, compared against cancellation version.

Only a fresh authenticated GET, matched to batch UUID/custom_id/invoice_id, configured merchant, gross USD total and exactly one full completed capture can finalize. Receipt, one confirmation, per-charge settlement events, allocation transitions, account restoration and audit commit atomically. Task lifetime spending is unchanged. Known orders are inspected on startup and every 30 seconds; recovery never automatically POSTs. Ambiguous creates require an owner retry with the original key/input. Three logical mutation attempts and a five-hour cutoff bound retries; expired ambiguity remains locked.

Owner pre-payment corrections reverse one whole unallocated charge, append an event/reason audit and restore its account/task projections once. Allocated or settled charges cannot be reversed or rebilled. This MVP offers no allocation release, remote void/refund API, webhook ingestion, AUTHORIZE or payouts. An owner resolves refunds externally and uses read-only reconciliation; the original receipt is immutable and later observations do not create another charge.

## Consequences

SQLite is the sole runtime accounting authority. Local effects are effectively once through uniqueness/reconciliation, not a distributed exactly-once claim. The local Bearer owner API is sufficient for P2; browser sessions/CSRF and the product console remain P3. Cancellation before creating an order has no resume path in this slice; funds remain payable/locked for manual handling. Safe allocation release is deferred rather than guessed from absence of a response.
