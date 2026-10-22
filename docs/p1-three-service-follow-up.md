# Priority follow-up: one mission, all three services, one final report

2026-10-22. Owner explicitly prioritized this gap after the P1 baseline commit. **Open; required before advancing to P2.** The existing minimum single-service live gate remains valid, but is not full three-service acceptance. Do not replace the historical live evidence or combine deliveries from separate tasks to claim success.

## Reproduced bottleneck

A new integration test runs the production LlmClient, numbered-source provider adapter, verifier and SQLite transactions with mocked HTTP. It uses one task and the durable eight-request budget, rather than bypassing providers with canned accepted flags:

| Provider corrections | Actual requests | Accepted charges | Final outcome |
| --- | --- | --- | --- |
| None | 7 | Three, total 750 | COMPLETED |
| Architecture once | 8 | Three, total 750 | COMPLETED |
| Architecture and risk once each | 8 sent; synthesis would need 9 | Three, total 750 | ACTION_REQUIRED / MODEL_CALL_BUDGET |

Baseline work is three purchase decisions, two model-backed providers, one finish decision and one synthesis = seven model requests. Inventory is deterministic. Two permitted provider corrections exhaust the budget before synthesis. Model transport retries and coordinator JSON repair compete for the same allowance. Restart does not replenish it. The failing task correctly retains accepted charges; it must not charge them again.

`test/mission.test.ts` reproduces all three cases. This proves a scheduling/budget constraint independently of model variability. It does not establish why historical generic MISSION_FAILED errors occurred; those runs lacked enough sanitized transport detail to conclude a precise cause. Source identity/evidence errors and risk coverage failures are separately recorded live facts.

## Additional acceptance gaps

- Generic COMPLETED currently means a schema-valid final report with at least one accepted delivery. The coordinator may finish early; that state does not require all three capabilities.
- Final finding IDs must be valid, but current validation does not require every accepted service to be represented in the final report.
- The original full-mission offline test substitutes provider results. The new test exercises the actual adapters with mocked HTTP, but neither substitutes for a live model run.
- Exact source provenance is necessary, not sufficient for semantic quality. Do not force invented risks merely to satisfy three risk claims or two files. Evidence insufficiency remains a legitimate failure.

## Recommended focused implementation

1. Define an explicit full-review acceptance profile: inventory, architecture and independent risk review all ACCEPTED on the same task, plus final findings covering all three delivery IDs. Keep scoped inventory-only/risk-only objectives distinct; no global assumption that every task must buy all services.
2. Reduce coordinator round trips: evaluate one registry-backed bounded procurement plan followed by deterministic quote/policy validation and execution. Preserve rejection feedback and bounded replanning. Reserve enough of the existing eight-call budget for final synthesis; fail visibly before spending on a plan that cannot complete. Do not simply raise the call cap or silently add Credit.
3. Test zero/one/two corrections, transport retry, early finish, missing final coverage, duplicate purchase and restart. Use production adapters with mocked HTTP plus real SQLite. Preserve exact evidence requirements, 750 total for a successful full review, and no orphan holds.
4. Only then perform a live full-review acceptance with an explicitly authorized accounting budget. Retain all prior histories and failed attempts; record actual request counts and provider attempts.

The current account has limit 1,000, outstanding 1,000, reserved 0 and available 0. No live rerun was attempted in this follow-up. Clearing the database, reopening terminal tasks, creating an unannounced replacement account or auto-increasing the limit would not validate the existing allowance rules. A new live run needs an explicitly authorized verification allowance or later valid settlement; neither happened here. No PayPal, Render or model request occurred in this investigation.

## Exit evidence required

One objective / task ID / pinned source revision; three distinct registry-backed accepted purchases with immutable verification and charges totaling 750; final findings citing all three deliveries; actual model calls within eight and original deadlines; successful ledger reconciliation and completed-task replay after restart without new charges or model requests. Include manual review of the usefulness/limitations of model findings. Keep this gate unchecked until that evidence exists.
