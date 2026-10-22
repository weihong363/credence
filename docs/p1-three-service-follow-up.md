# Priority follow-up: one mission, all three services, one final report

2026-10-22. Owner explicitly prioritized this gap after the P1 baseline commit. **Live gate passed on 2026-10-22** in an explicitly authorized independent verification ledger (limit 1,500). The existing minimum single-service live gate remains valid, but is not full three-service acceptance. Do not replace the historical live evidence or combine deliveries from separate tasks to claim success.

## Reproduced bottleneck before the fix (05b2db2)

A new integration test runs the production LlmClient, numbered-source provider adapter, verifier and SQLite transactions with mocked HTTP. It uses one task and the durable eight-request budget, rather than bypassing providers with canned accepted flags:

| Provider corrections | Actual requests | Accepted charges | Final outcome |
| --- | --- | --- | --- |
| None | 7 | Three, total 750 | COMPLETED |
| Architecture once | 8 | Three, total 750 | COMPLETED |
| Architecture and risk once each | 8 sent; synthesis would need 9 | Three, total 750 | ACTION_REQUIRED / MODEL_CALL_BUDGET |

Baseline work is three purchase decisions, two model-backed providers, one finish decision and one synthesis = seven model requests. Inventory is deterministic. Two permitted provider corrections exhaust the budget before synthesis. Model transport retries and coordinator JSON repair compete for the same allowance. Restart does not replenish it. The failing task correctly retains accepted charges; it must not charge them again.

The investigation commit’s `test/mission.test.ts` reproduced all three cases; current tests assert the corrected call counts below. This proves a scheduling/budget constraint independently of model variability. It does not establish why historical generic MISSION_FAILED errors occurred; those runs lacked enough sanitized transport detail to conclude a precise cause. Source identity/evidence errors and risk coverage failures are separately recorded live facts.

## Additional acceptance gaps before the fix

- Before this change, generic COMPLETED meant a schema-valid final report with at least one accepted delivery. The coordinator may finish early; that state does not require all three capabilities.
- Final finding IDs must be valid, but the previous validation did not require every accepted service to be represented in the final report.
- The original full-mission offline test substitutes provider results. The new test exercises the actual adapters with mocked HTTP, but neither substitutes for a live model run.
- Exact source provenance is necessary, not sufficient for semantic quality. Do not force invented risks merely to satisfy three risk claims or two files. Evidence insufficiency remains a legitimate failure.

## Approved implementation scope

1. Define an explicit full-review acceptance profile: inventory, architecture and independent risk review all ACCEPTED on the same task, plus final findings covering all three delivery IDs. Keep scoped inventory-only/risk-only objectives distinct; no global assumption that every task must buy all services.
2. Reduce coordinator round trips: evaluate one registry-backed bounded procurement plan followed by deterministic quote/policy validation and execution. Preserve rejection feedback and bounded replanning. Reserve enough of the existing eight-call budget for final synthesis; fail visibly before spending on a plan that cannot complete. Do not simply raise the call cap or silently add Credit.
3. Test zero/one/two corrections, transport retry, early finish, missing final coverage, duplicate purchase and restart. Use production adapters with mocked HTTP plus real SQLite. Preserve exact evidence requirements, 750 total for a successful full review, and no orphan holds.
4. Only then perform a live full-review acceptance with an explicitly authorized accounting budget. Retain all prior histories and failed attempts; record actual request counts and provider attempts.

At the initial investigation, the original account had limit 1,000, outstanding 1,000, reserved 0 and available 0; no live rerun had been attempted. Clearing the database, reopening terminal tasks, creating an unannounced replacement account or auto-increasing the limit would not validate the existing allowance rules. A new live run required explicit verification allowance authorization. That authorization and subsequent independent run are documented below; the initial investigation itself made no PayPal, Render or model request.

## Exit evidence required

One objective / task ID / pinned source revision; three distinct registry-backed accepted purchases with immutable verification and charges totaling 750; final findings citing all three deliveries; actual model calls within eight and original deadlines; successful ledger reconciliation and completed-task replay after restart without new charges or model requests. Include manual review of the usefulness/limitations of model findings. The evidence is now recorded in [full-review live evidence](p1-full-review-live-evidence.json); historical earlier runs remain unchanged.

## Implemented locally on 2026-10-22

[ADR 0009](decisions/0009-bounded-review-plans.md) records the focused change. `pnpm mission` explicitly requests `full-review`; scoped API missions remain available for limited objectives. Both use one immutable model-selected plan. Full review rejects incomplete plans before purchases and requires all three services plus final citation coverage. Insufficient allowance/per-purchase policy rejects before source/model requests. Current state/history is not reset.

| Current production-code test (mock HTTP) | Model requests | Result |
| --- | --- | --- |
| No correction | 4 | Three accepted, total 750, covered final report |
| Architecture correction | 5 | Same success |
| Both provider corrections | 6 | Same success |
| Both corrections plus one HTTP retry per provider | 8 | Same success |
| Missing required plan entry / early stop | At most two planning requests | Rejected before holds/charges |
| Required service rejected | Bounded | ACTION_REQUIRED, its hold released; accepted work retained |
| Missing final delivery coverage | Bounded | ACTION_REQUIRED; accepted work retained |

The last request is protected from planning/provider use. Request purpose, plan and profile survive restart; restarting a partially executed full review reuses its invocation/quotes and yields exactly three charges. Completed-task replay makes no requests or charges. These are deterministic local tests, not live AI evidence.

Initial offline validation passed 65 tests before the owner authorized the live verification. Subsequent verification and allowance-policy tests pass 66/66, type checks, production smoke and diff checks. The owner authorization and actual result are recorded below.

## Real acceptance after explicit owner authorization

The owner authorized a separate live run and raised its Credit limit to **1,500**. The independent database is `.data/p1-full-review-verification.sqlite`; account policy changed through an owner-checked transaction and immutable audit (`POLICY:LIMIT:1000->1500`). The original `.data/credence.sqlite` and existing sidecars matched their pre-run file hashes; its financial records were not opened or modified.

Task `6a131fa3-6968-40a6-9896-441b7f22d22e` completed as **full-review** against expressjs/cors commit `5317ebe670db2aaebc1d496eb5d33493deefb3ed`, using configured `deepseek-v4-pro`:

- One persisted plan selected all three registry services.
- Inventory accepted on attempt 1; architecture failed schema on attempt 1 and passed its one correction; independent risk passed attempt 1.
- Exactly three charges: 125 + 250 + 375 = **750**, with no charge for the invalid attempt.
- Exactly five real model requests: one planning, three provider, one synthesis; all within the original eight-call bound and task deadline.
- The final report cited all three accepted delivery IDs. All deliveries revalidated against the pinned source and the ledger reconciled.
- Close/reopen and completed-task replay returned the identical report with zero additional model requests, charges or ledger events.
- Independent account: limit **1,500**, reserved **0**, outstanding **750**, available **750**. Zero PayPal requests; no payment, payout or lending.

See [sanitized evidence including the actual report](p1-full-review-live-evidence.json). Semantic review remains qualified: the Express application is example/test integration, not a separate production service. Permissive CORS defaults, old Node CI and major-update policy are conditional adoption caveats, not established exploitable vulnerabilities. The five-consecutive-mission/payment demonstration remains P3; this records one real full-review success.

Inspect this ledger explicitly (the default still points to the original ledger):

```sh
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite pnpm economy status
```

The local owner-only command `pnpm economy limit ACCOUNT_ID MINOR` changes only the selected account policy with an audit record. It rejects wrong ownership, invalid money and limits below existing obligations or the per-purchase cap, rolls back on audit failure, and treats an identical repeated limit as a no-op. Never use it from provider/model tools or automatically replenish allowance.
