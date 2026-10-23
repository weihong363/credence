# Architecture decisions

These records select the planned architecture; they do not claim implementation. P0 behavior is preserved in its [compatibility report](../paypal-sandbox-compatibility.md). P1 local core is implemented following owner authorization; the minimum live gate passes; later phases remain. Change a decision by adding a superseding ADR and updating [spec](../spec.md), [settlement](../settlement.md) and [roadmap](../roadmap.md).

| ADR | Decision | Implementation |
| --- | --- | --- |
| [0001](0001-internal-credit.md) | Bounded internal allowance, no lending | P0 fixture bound only; full account P1 |
| [0002](0002-modular-monolith.md) | Local modular agents with explicit contracts | Planned P1 |
| [0003](0003-human-approved-settlement.md) | Owner approves external settlement | P0 live verified; dynamic batch P2 |
| [0004](0004-append-only-ledger.md) | Append-only financial events, transactional projections | Planned P1/P2 |
| [0005](0005-single-merchant-sandbox.md) | One Sandbox receiver, no provider payouts | P0 live verified; maintain in P2 |
| [0006](0006-sqlite-and-phase0-cutover.md) | SQLite core with explicit P0 integration boundary | Planned P1/P2 |
| [0007](0007-reservation-foundation.md) | Staged internal reserve-only foundation, no public spending API | P1.1 locally tested |
| [0008](0008-p1-local-procurement.md) | Isolated local procurement CLI, durable jobs/model budgets and source-backed verification | Offline checks and minimum live AI gate pass |
| [0009](0009-bounded-review-plans.md) | One durable plan, explicit review profiles, reserved synthesis capacity | Local tests and owner-authorized full-review live gate pass |
| [0010](0010-frozen-batch-foundation.md) | Frozen whole-charge batching before payment integration, one existing journal | P2.1 local verification |
| [0011](0011-durable-sandbox-settlement.md) | Durable owner-approved payment intent, authoritative GET and atomic finalization | P2 local tests; live status in P2 evidence |
| [0012](0012-owner-session-read-foundation.md) | Process-local owner sessions, CSRF and explicit read projections | P3.1 local tests and compiled process acceptance |
| [0013](0013-read-only-console.md) | Same-origin vanilla TypeScript activity console and bounded source-evidence projections | P3.2 local tests and mock browser acceptance |
| [0014](0014-owner-financial-console.md) | Explicit owner financial UI over existing settlement authority | P3.3 offline and mock-browser acceptance |
