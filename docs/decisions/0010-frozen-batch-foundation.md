# ADR 0010: transactional frozen batches before payment integration

Accepted 2026-10-22 for owner-authorized P2.1.

Keep P0 isolated. Freeze real accepted charges in the existing SQLite application boundary before adding a payment adapter. Extend the existing financial journal with zero-balance allocation events rather than introducing another ledger. Use owner-scoped normalized replay keys plus charge-level database uniqueness so new keys cannot duplicate obligations.

Financial fields and allocation rows are immutable. This slice supports only FROZEN/LOCKED; safe releases, charge reversals and payment state transitions require subsequent versioned migrations and tests. No allowance is restored by batching, and no network call occurs within its transaction. Migration 6 preserves P1 history and restores charge-evidence triggers after the ledger/charge table rebuild. Verification and CLI boundaries are in [P2 verification](../p2-verification.md).
