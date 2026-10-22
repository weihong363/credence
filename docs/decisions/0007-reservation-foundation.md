# 0007 — Stage the reserve-only accounting foundation

Status: implemented locally, 2026-10-21. Refines the implementation sequencing of ADR 0006; the full entity contract remains the target.

The owner asked to skip the Render billing blocker and continue. Complete P1.1 before registry or procurement: integer USD, real SQLite transactions and reserve history. Pin better-sqlite3 12.4.1 (its package declares Node 20 support); explicitly permit its native installation script in pnpm. Native binding and competing processes are tested locally; hosted Linux support remains unverified.

Migration 1 creates minimal accounts, tasks, reservations, ledger events and economic audit. Account/task relationships are enforced with foreign keys; ledger and audit reject UPDATE/DELETE. Identity UUIDs and unique purchase-intent UUIDs have no registry/purchase foreign keys yet because those entities belong to P1.2/P1.3. Subsequent migrations must validate existing references before establishing the complete entity contract. These rows are test fixtures, not accepted obligations or historical P0 charges. No public provisioning or reserve route is exposed. No runtime DB path or automatic server migration is enabled yet.

The internal reserve command validates integer money, ownership, active/unexpired account, task deadline, per-purchase cap, account availability and task budget within BEGIN IMMEDIATE. A hold, account/task projections, ledger event and audit entry commit together. Same account/key/payload returns the original hold even after expiry; changed payload conflicts. Unique purchase IDs block duplicate holds under another key. The hash uses an explicitly ordered tuple of semantic request fields; future arbitrary JSON contracts require recursive canonicalization.

Reservation state and ledger event constraints intentionally accept only HELD and CREDIT_RESERVED today. Release/consume state transitions, quote/capability authorization, account provisioning/audit and full reconciliation are future slices; do not expose this foundation to agents until those guards exist. Database administrator tampering is outside the append-only guarantee.

Acceptance: two separate processes open the same temporary WAL database and are released together to reserve 70 and 40 against limit 100. Exactly one commits. Replay, duplicate purchase, immutable history, policy/budget denials and an audit-insert failure demonstrate uniqueness and full rollback. Existing P0 regression/production smoke tests remain authoritative for payment behavior; this slice makes no remote API calls.
