# ADR 0002: Explicit agents in a modular monolith

Date: 2026-10-21. Status: selected for specification; P1 implementation pending.

## Context

The demo requires an economically meaningful coordinator and two distinct provider identities. It does not require network-distributed execution to demonstrate independent capabilities or policy boundaries.

## Decision

Run coordinator, trusted registry, local providers, verification, ledger and settlement in one TypeScript/Node application. Define versioned invocation/delivery contracts and local code-controlled handlers. Providers B/C can share infrastructure but maintain separate identities and responsibilities; C reviews the same pinned source independently of B's conclusions. Use one SQLite database and durable local jobs, not microservices.

## Alternatives and consequences

A distributed A2A network adds identity, transport, delivery and trust problems before basic accounting works. An undifferentiated chatbot hides purchase boundaries. Local contracts provide clear module tests and later transport adapters without claiming protocol compliance now. External agents, dynamic reputation, Kubernetes and multi-hop delegation are deferred. See [spec](../spec.md).
