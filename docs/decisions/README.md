# Architecture decisions

These records select the planned architecture; they do not claim implementation. P0 behavior is preserved in its [compatibility report](../paypal-sandbox-compatibility.md). Implementation approval for P1–P4 remains pending. Change a decision by adding a superseding ADR and updating [spec](../spec.md), [settlement](../settlement.md) and [roadmap](../roadmap.md).

| ADR | Decision | Implementation |
| --- | --- | --- |
| [0001](0001-internal-credit.md) | Bounded internal allowance, no lending | P0 fixture bound only; full account P1 |
| [0002](0002-modular-monolith.md) | Local modular agents with explicit contracts | Planned P1 |
| [0003](0003-human-approved-settlement.md) | Owner approves external settlement | P0 live verified; dynamic batch P2 |
| [0004](0004-append-only-ledger.md) | Append-only financial events, transactional projections | Planned P1/P2 |
| [0005](0005-single-merchant-sandbox.md) | One Sandbox receiver, no provider payouts | P0 live verified; maintain in P2 |
| [0006](0006-sqlite-and-phase0-cutover.md) | SQLite core with explicit P0 integration boundary | Planned P1/P2 |
