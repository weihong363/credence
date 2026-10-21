# ADR 0006: Transactional SQLite core and an explicit P0 cutover

Date: 2026-10-21. Status: selected architecture; no dependency or source changes in this documentation task.

## Context

P0 uses strict TypeScript, native Node HTTP/fetch, one JSON snapshot and a process lock. It has valuable verified transport behavior and historical fixture receipts, but no transactional accounts, dynamic charge identity or append-only history. Node 20 does not supply the planned database through this repository's current dependencies.

## Decision

Keep the runtime and install a Node-compatible better-sqlite3 dependency only when implementing P1.1. Use SQL migrations, foreign keys, WAL, FULL synchronization, constrained unique financial identities and BEGIN IMMEDIATE reservation transactions. Choose Vite/vanilla TypeScript for the P3 console without replacing the backend framework.

Preserve P0 source/evidence during P1. In P2 wrap its PayPal transport with a provider-neutral adapter and switch new real-charge batches to the new service. Do not import simulated P0 charges as real accepted purchases or let both services own the same obligation. Preserve the historical receipt separately; archive the fixed-bill HTTP entry point at cutover while keeping its regression verification available explicitly.

## Alternatives and consequences

File locks plus JSON would need hand-built transactions; PostgreSQL/cloud services add setup burden for a local single-owner monolith. SQLite provides enough correctness with little infrastructure, but native dependency installation and real two-connection tests are prerequisites. Test portability before expanding schema; if native installation fails, document a revised ADR rather than introducing two storage authorities. No compatibility facade or silent data migration is required. [Roadmap](../roadmap.md) orders the cutover; unresolved P0 payments must be reconciled before disabling its runner.
