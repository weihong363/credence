# ADR 0005: One Sandbox merchant; no provider payout claim

Date: 2026-10-21. Status: P0 verified; maintained as P2 scope.

## Context

The hypothesis is that bounded internal procurement can accumulate into one owner-approved test payment. Proving this does not require commercial onboarding or splitting payments between independent merchants.

## Decision

Configure one Sandbox Business receiver associated with the REST app; a separate Personal buyer approves. A batch has one purchase_unit, merchant and currency. Internal provider charges trace economics but do not imply independent providers received money. PayPal gross captured amount must equal the frozen charge total; provider fees are not internally allocated.

## Alternatives and consequences

Marketplace split payments, payouts and commercial merchant onboarding add separate authorization/regulatory/provider requirements and are excluded. No production PayPal or Alipay integration. A provider-neutral payment port allows future authorized adapters without leaking provider objects into the economic domain. [P0 evidence](../phase0-settlement-evidence.json) is a real Sandbox payment to this single merchant, not a real provider distribution.
