# Credence product requirements

Status: specification for P1–P4, 2026-10-21. Only the [P0 payment spike](paypal-sandbox-compatibility.md) exists. Technical authority: [spec](spec.md). Accounting authority: [settlement](settlement.md). Execution authority: [roadmap](roadmap.md).

## Problem and value

An agent can discover a missing capability but ordinarily either gives up or requires the user to manage tools, credentials and individual payments. Credence lets it procure useful work within a fixed allowance while preserving human approval over external settlement. Economic autonomy, traceable accountability and human financial sovereignty are separate responsibilities.

Target users are developers of agent workflows and owners supervising bounded delegated work; hackathon reviewers are the first audience for reproducibility. This is an economic execution layer, not a bank, loan product, checkout gateway or marketplace.

## Minimum complete journey

1. Owner creates a mission: “Evaluate this public GitHub repository for adoption and explain its main risks.” Owner selects a Credit account and policy.
2. Coordinator A reads actual registry metadata, identifies missing capabilities, requests authoritative quotes and proposes purchases with short explanations.
3. Deterministic policy reserves allowance; local Provider B performs repository inventory and architecture analysis, and Provider C performs an independent risk review of the same pinned revision.
4. Each handler returns real source-based evidence. Accepted delivery produces exactly one service charge. A deliberately invalid delivery is visibly rejected and cannot produce a charge.
5. Coordinator synthesizes accepted results into a useful adoption report with revision and evidence links. It can finish the task while settlement remains outstanding; failure to pay does not turn factual analysis into accepted payment.
6. Owner inspects three accepted charges, freezes a single batch, opens PayPal Sandbox, approves, and requests backend capture. Authenticated payment verification settles that batch once and restores allowance according to policy.

Agents B and C run in the same application. A local contract is the boundary, not a claim to implement an external A2A protocol. GitHub is one fixture domain; capability schemas and handlers remain replaceable.

## Functional requirements and acceptance

| ID | Requirement | Acceptance oracle | Phase |
| --- | --- | --- | --- |
| F01 | Versioned local registry with identity, roles, schemas, prices, timeout, availability and verification rules | Unknown/unavailable versions cannot be quoted or invoked | P1 |
| F02 | Model-supported capability discovery and procurement | A proposes actual quote IDs based on registry; deterministic code rejects invented IDs/prices | P1 |
| F03 | Owner-controlled limit, per-purchase limit, allowlist, expiry and suspension/revocation | Parallel reservations cannot exceed available Credit or bypass policy | P1 |
| F04 | Quote, reservation, execution and accepted delivery with evidence | Every charge traces to one purchase, accepted delivery, quote, task and provider | P1 |
| F05 | Meaningful AI-supported service work | At least architecture analysis and risk review use a configured live LLM; fixtures are labeled test-only | P1 |
| F06 | Rejected delivery and bounded correction | Invalid attempt does not charge; one correction may succeed before deadline, final rejection releases Credit | P1 |
| F07 | Append-only economic history and derived balances | Transaction rollback, replay and recomputation agree with all projections | P1 |
| F08 | Aggregate only eligible accepted charges, one currency/owner/account/merchant | Three actual charges form one frozen amount; competing batches cannot allocate them twice | P2 |
| F09 | Human-approved payment with authoritative reconciliation | Matching order and completed capture settle once, never from redirect alone | P2 |
| F10 | Failure transparency | Cancel, timeout, unknown payment, expired quotes, service failure and exhausted Credit are actionable states | P1/P2 |
| F11 | Mission, agents, policy, deliveries, ledger and settlement console | Owner can explain each balance change and inspect evidence without developer tools | P3 |
| F12 | Reproducible submission | Five sequential controlled runs; accurate English docs/video and public licensed source | P3/P4 |

Demo account: limit 1,000 units, per-purchase cap 400, USD only, 1 internal unit = USD 0.01. Three default quotes: 125/250/375 units. This is local pricing and conversion, not a promise of available PayPal funds. Model/API infrastructure costs are borne by the operator and are not automatically charged to this allowance.

## Non-functional requirements

Correctness precedes speed: all money transitions are transactional and replay-safe, integer-valued and tenant-scoped. Persist before external side effects; stop uncertain mutations rather than create a replacement payment. Objective output/schema checks do not prove truth; subjective quality is recorded separately. Keep a timestamped, ordered audit trail and sanitized errors.

One trusted local owner, one process and one SQLite database are sufficient. Providers perform read-only public-repository work; never execute repository code. Task execution is asynchronous and recoverable. A local mission must finish or reach a visible action-required state within its bounded five-minute execution budget, excluding human approval. Individual provider calls have bounded deadlines. External latency is not a product guarantee. LLMs have no direct database or payment access. A fresh clone can run deterministic tests without credentials; a real AI/Sandbox demonstration requires the reviewer's own configured credentials.

## Scope and exclusions

In scope: three local roles, two provider identities, three executions, trusted registry, fixed versioned quotes, bounded allowance, read-only useful services, evidence verification, append-only history, one merchant, Sandbox CAPTURE, owner consent, local console, demo and submission materials.

Out of scope: real lending, interest, installments, credit scoring/collections; PayPal credit products; payouts and merchant splits; commercial onboarding; automatic off-session charges; external trust/reputation; distributed protocol implementation; multi-hop delegation; graph editors, marketplace browsing, Kubernetes and blockchain. Optional AUTHORIZE is deferred. Alipay Skill Pay/Agent Pay, real provider payments, netting and enterprise budgets are future opportunities only.

## Phase acceptance and honest demonstration

P1 must complete procurement through ledger without PayPal. P2 must use real accepted service charges and a real Sandbox response; P0's fixture charges cannot satisfy P2. P3 must show causal state changes and pass five consecutive missions/batches without database edits. A model- or payment-provider outage is a failure/action-required state, never fabricated success. P4 requires actual publication artifacts, not placeholder links.

A selected quote is not an accepted service; accepted service is not payment; payment to the single merchant is not payment to each provider. The owner can cancel payment while service obligations remain outstanding and visible. Current P0 amount USD 7.50 differs from an earlier USD 7.00 checklist; preserve the original evidence.
