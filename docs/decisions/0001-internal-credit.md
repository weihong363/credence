# ADR 0001: Internal Credit is bounded allowance

Date: 2026-10-21. Status: selected for specification; P1 implementation pending.

## Context

Autonomous procurement needs deterministic permission to incur service costs. PayPal Sandbox neither grants financing to agents nor validates service delivery. Calling a local numerical limit “credit” must not imply a bank product, guaranteed funds or legal borrowing by an agent.

## Decision

Use owner-authorized internal allowance, denominated 1 unit = USD 0.01 in the MVP. Available = limit − held reservations − outstanding accepted charges. Atomic reservations enforce account, task and per-purchase limits; verified settlement restores the account allowance, not the task's lifetime budget. Only deterministic application services can make these transitions.

## Alternatives and consequences

Pre-funded wallets add custody/actual-funds semantics; lending adds unrelated regulated obligations; free unlimited tool calls omit the product hypothesis. Reject all three for this MVP. Explain that the operator pays AI infrastructure costs separately. No interest, installments, collection or scoring. Multiple currencies and delegation are deferred. Exact rules live in [settlement](../settlement.md).
