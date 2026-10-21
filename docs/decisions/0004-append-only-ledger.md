# ADR 0004: Append-only economic events with transactional projections

Date: 2026-10-21. Status: selected for P1/P2; P0 JSON snapshot is not this ledger.

## Context

Balances alone cannot explain reservations, rejected deliveries, accepted obligations and repeated payment attempts. Silent financial-row edits would hide errors and defeat reconciliation.

## Decision

Append immutable, uniquely deduplicated financial events. Keep balances and workflow status as rebuildable mutable projections. Commit event, projection, uniqueness claims and next job in one SQLite transaction. Enforce immutable rows with database triggers. Accepted-charge and capture/allocation uniqueness prevent repeat accounting; corrections append explicit reversals/observations.

## Alternatives and consequences

A single mutable JSON snapshot was adequate for the P0 fixed bill, but cannot support concurrent purchases. Full event-sourcing infrastructure or blockchain is unnecessary. Use ordinary relational tables plus a focused append-only financial journal. Local administrators can still tamper with storage; do not claim cryptographic external immutability. Replay/rollback/concurrency tests are mandatory. Details: [accounting](../settlement.md), [schema](../spec.md).
