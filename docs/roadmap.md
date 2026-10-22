# Credence execution roadmap

Authority: [spec](spec.md), [settlement](settlement.md), [product](product.md). Status audited 2026-10-21. **Owner authorized P1 implementation. P1 local core and minimum real DeepSeek gate pass; full three-service/five-run demonstrations remain later gates. Cloud creation/deployment is not authorized.** Dates below are planning windows, not completed work or promises. Effort assumes one developer with AI assistance and excludes waiting for owner/payment approvals.

## Verified baseline and gaps

P0 source is a minimal native Node/TypeScript local payment spike. `pnpm check` and 18 mocked tests are the present baseline. Live evidence is recorded in [settlement evidence](phase0-settlement-evidence.json), [negative evidence](phase0-negative-evidence.json) and the [compatibility report](paypal-sandbox-compatibility.md).

- [x] Server-side Sandbox OAuth, single configured Business receiver, Orders v2 create/get/capture.
- [x] Personal buyer approval; backend capture and independent GET prove order/capture COMPLETED.
- [x] Three simulated charges associated with fixed bill/order/capture: USD 1.25+2.50+3.75=7.50.
- [x] Repeated owner settlement calls retain the same receipt and exactly one capture.
- [x] Graceful server restart retains the completed bill/receipt.
- [x] Official Sandbox INSTRUMENT_DECLINED injection returns HTTP 422; local cancellation, timeout, retry and identity tests.
- [ ] Optional AUTHORIZE and delayed CAPTURE — deferred, not a gate.
- [ ] Genuine buyer funding decline, real network loss during capture, power-loss durability and independent buyer/receiver Activity-page review — not established; recorded as broader operational checks, not invented P0 passes.

Actual P0 order: `0LX18082EW768591D`; capture: `3V026169LS895662F`; captured 2026-10-21 at 16:27:47 Asia/Shanghai. Earlier checklist amount USD 7.00 is inconsistent with real USD 7.50 evidence; keep actual evidence unchanged. P0 does not establish procurement, transactional reservations or an append-only ledger. Those are P1/P2 deliverables.

## Dependencies, schedule and effort

| Phase | Suggested dates (Asia/Shanghai) | Estimate | Prerequisite / exit gate |
| --- | --- | --- | --- |
| P1 Economic core | Oct 25–30 | 5–7 developer-days | Approved docs + implementation authorization → real AI procurement-to-ledger without PayPal |
| P2 Aggregate settlement | Oct 31–Nov 4 | 3–5 developer-days | P1 accepted + existing Sandbox receiver → three real accepted charges paid once |
| P3 Product console | Nov 5–8 | 3–4 developer-days | P2 accepted → five consecutive end-to-end runs, clear human approval |
| P4 Submission | Nov 9–10 | 1–2 developer-days | P3 evidence + publication authorization → reproducible public submission |

Total 12–18 developer-days; the 17-calendar-day window has little contingency at the high end. Oct 21–24 may be used for planning/configuration, not assumed implementation time. Nov 11–12 is contingency before the official deadline. Reduce optional UI detail and AUTHORIZE before reducing correctness, real AI work or approval gates. Update dates based on measured P1 throughput.

Official [schedule](https://paypalaihackathon.devpost.com/details/dates) and [rules](https://paypalaihackathon.devpost.com/rules), checked 2026-10-21, list November 12 at 12:00 PST, equivalent to **November 13 at 04:00 Asia/Shanghai**. Internal submission target remains November 10. Recheck at P4; these are external mutable requirements. Public licensed source, a functioning reproducible build, public YouTube video under three minutes, and English materials are submission requirements; a hosted site is not mandatory.

## P1 — Agent Economic Core

P1.1–P1.4 pass local acceptance; P1.5–P1.6 pass the minimum real-AI gate; all capabilities were exercised across retained missions, with a completed risk-only procurement/report task. Keep PayPal disabled for P1 acceptance.

| ID | Ordered vertical slice | Effort | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| P1.1 | Checked USD minor-unit type + real SQLite migration/transaction harness; account/reservation/ledger foundation | 1 day | Documentation approval, Node-compatible SQLite package installation | Two DB connections compete for limit 100: reserve 70 and 40; only one succeeds, committed R<=100; rollback/replay tests pass |
| P1.2 | Seed owner, buyer A/providers B/C, versioned capabilities; authoritative quotes and policy | 0.75 day | P1.1 | Unknown service, unavailable version, expired quote, wrong owner, per-purchase cap and allowlist tests; no side effects on denial |
| P1.3 | Purchase/reservation transaction, unique quote consumption, invocation jobs and restart recovery | 1 day | P1.2 | Same/new request key cannot repurchase quote; cancel/accept race; lease recovery; no orphan hold |
| P1.4 | Pinned public repository snapshot + real inventory provider | 0.75 day | P1.3 | Input limits/host restrictions; real source artifacts/hash/path checks; no repository code executed |
| P1.5 | LLM adapter, structured coordinator procurement, architecture + independent risk providers | 1–1.5 days | P1.4, chosen LLM endpoint/model/key and successful capability probe | Live model makes registry-backed purchases and uses actual source; no price/ID hallucination can bypass policy; record sanitized model/run metadata |
| P1.6 | Delivery verification, one correction, accepted charges, task synthesis and negative matrix | 1 day | P1.5 | Invalid attempt cannot charge; corrected result or final release; all accepted artifacts trace to source; final answer consumes purchased work |

- [x] P1.1 foundation and concurrency oracle (real local SQLite; two independent processes, replay, rollback, audit immutability).
- [x] P1.2 registry, quotes and policy (local tests).
- [x] P1.3 lifecycle and durable execution (real DB restart, lease fencing, two-process cancel/accept race).
- [x] P1.4 useful real source inventory (pinned expressjs/cors, 16 files / 59,570 bytes; live GitHub read, no code execution).
- [x] P1.5 real AI-supported procurement and services — deepseek-v4-pro live exercised; inventory/architecture/risk independently accepted.
- [x] P1.6 accepted delivery and ledger, negative tests, useful final task result — real risk-review task completed with source-backed delivery and cited synthesis; semantic caveats recorded.
- [x] P1 gate: one original objective → coordinator identifies a capability → authoritative quote → atomic reservation → real provider execution → verified delivery → one accepted payable → coordinator continuation, **without PayPal**.

Mandatory negative cases: insufficient Credit; per-transaction policy limit; unknown service; expired quote; duplicate purchase; two-connection overspending; service exception/timeout; invalid schema/evidence; attempt correction deadline; revoked account; late delivery/cancel race. Run type/unit/real-DB integration tests and one opt-in live AI run. Do not mark P1 accepted using canned provider conclusions or fixture verified flags.

**P1 minimum gate completed:** see [P1 verification](p1-verification.md) and [live evidence](p1-live-evidence.json). One real risk-only procurement/report task completed; a single successful three-service mission is not established. P2 is the next phase and was not started.

## P2 — Aggregated PayPal Settlement

| ID | Slice | Effort | Depends on | Acceptance evidence |
| --- | --- | --- | --- | --- |
| P2.1 | Immutable batches/allocations and full-charge selection transaction | 0.75 day | P1 gate | Three accepted charges freeze; rejected/corrected charges excluded; competing batch blocked; exact total and replay |
| P2.2 | Provider-neutral payment port over preserved P0 PayPal transport; isolate old fixed routes | 0.75 day | P2.1 | Adapter contracts retain P0 payloads/retries; no runtime domain imports raw PayPal Order; no P0 fixture charge imported as real |
| P2.3 | Durable create/capture intent, owner consent, cancellation/resume and observations | 1 day | P2.2 | Redirect never settles; cancel prevents initiation; complete GET validates all identifiers and gross total |
| P2.4 | Atomic finalization, balance restoration, recovery jobs, pre-payment corrections and manual refund policy | 0.75–1 day | P2.3 | One confirmation/allocation settlement after retries/crash; projection replay matches; no rebilling unknown outcomes |
| P2.5 | Real multi-service Sandbox acceptance and report | 0.75–1 day | P2.4, owner Personal-buyer participation | Three actual accepted services → one frozen batch → one real completed payment, same IDs after repeated requests/restart |

- [ ] P2.1 dynamic batching.
- [ ] P2.2 adapter wrapper and documented P0 cutover.
- [ ] P2.3 approval/capture lifecycle and authoritative reconciliation.
- [ ] P2.4 ledger finalization, corrections/recovery and negative tests.
- [ ] P2.5 live gate with evidence and owner-visible obligations.

Gate guarantees: no rejected deliveries in payable batches; no allowance restored before verified capture; one allocation/charge confirmation; frozen totals and USD formatting; no secret exposure; single merchant, no independent provider payout claim. Test UNKNOWN on lost create/capture, pending status, stale retries, wrong merchant/amount, duplicate/delayed event hints, cancellation race and failed commit after remote success. Default CI remains offline/mocked. Webhooks, refund API and AUTHORIZE stay deferred; documented polling/reconciliation is sufficient.

## P3 — Product Experience and Demonstration

- [ ] P3.1 (0.5 day): same-origin session/CSRF auth, sanitized read APIs and monotonic event polling; no owner/PayPal credential in JS storage.
- [ ] P3.2 (1 day): mission and agent activity, quote/purchase reasoning summaries, reservation/execution/delivery transitions, evidence inspection; avoid a graph editor.
- [ ] P3.3 (0.75 day): limit/reserved/outstanding/available policy view and ledger/batch breakdown with owner PayPal approval/capture/reconcile controls.
- [ ] P3.4 (0.75–1.5 days): final result and honest failure states, English copy, accessibility, loading/error recovery and controlled run harness.
- [ ] Gate: **five consecutive complete missions** with three real accepted purchases each, separate batches, real AI work and real Sandbox payments; same persistent DB, no manual financial edits or developer-console intervention. Human Sandbox approval remains part of each run. Record task/batch IDs, source revisions, totals, order/capture IDs, timestamps and negative/corrected-delivery observations.

A fixture-only UI replay may support rehearsal but cannot count among the five real runs. Failed run resets the consecutive counter after fixing the cause; preserve all prior audit history. The local reproduction path remains mandatory. Per the sponsor strategy, prioritize a Render public demo in P3/P4 after hosted security and persistent-state acceptance; hosting is not a substitute for the five-run gate.

## P4 — Hackathon Submission

- [ ] P4.1 (0.5 day): choose/apply open-source license with owner attribution; sanitize repository; publish public source only with owner authorization; verify no `.env`, DB, artifacts, tokens or private payer/source data in files/history. Public URL must be real, not placeholder.
- [ ] P4.2 (0.5 day): fresh-machine install/test/demo rehearsal using reviewer's own Sandbox/AI configuration; complete architecture/setup/real-versus-simulated README. Confirm dependency/native SQLite installation works.
- [ ] P4.3 (0.5 day): record/edit English demo under three minutes using [storyboard](demo-script.md); upload public YouTube video with actual functioning app and permission for included material.
- [ ] P4.4 (0.5 day): Devpost narrative, screenshots, repo/video links and reproduction instructions; check official rules/eligibility/deadline; owner reviews concrete submission before external publishing/submission.
- [ ] Gate: reviewer can reproduce core behavior without developer personal credentials; all placeholder links replaced; successful public link checks, complete setup, license and actual submitted materials recorded.

Source license and published URLs are currently absent. Do not label submission done because the files were drafted. Credentials required for reviewers must be obtained through their own Sandbox app/AI provider or a separately approved controlled demo arrangement; never embed developer secrets.

## Sponsor delivery and evaluation work (planned, not installed)

Authority: [sponsor resources](sponsor-resources.md). Prioritize Render hosting and Postman API tooling. Optional candidate count is capped at **two: APIMatic and AG Studio**. Astropods, Elastic, KERNEL, Bryntum, Channel3 and Zapier have no scheduled work unless an actual unmet requirement is demonstrated. No additional sponsor should be selected just for prize breadth.

| Phase | Sponsor work / gate | Incremental effort |
| --- | --- | --- |
| P1 | Specify Postman environment/collection shape alongside actual HTTP contracts; keep Node/SQLite tests authoritative. Optional APIMatic read-only development-context evaluation can start after P1.1; inspect source/version and actual Codex support before later installation. | Part of 0.5–1 day Postman total; 2–4 hours APIMatic evaluation |
| P2 | Export actual procurement/settlement collections and assertions, official PayPal reference links, manual buyer pause and same-ID retries. Use APIMatic only if useful and verified; do not rewrite P0/native fetch or claim historical usage. | Remainder of Postman total; no new API SDK required |
| P3 | Render single-instance paid service/persistent disk; HTTPS/session/callback configuration, runtime migrations, durable jobs and restart/replay checks. AG Studio evaluation only for credit/activity/settlement read views; resolve hosted trial license and preserve vanilla TypeScript/native fallback. | 1–2 days deployment; AG evaluation <=4 hours, optional adoption another 1–2 days |
| P4 | Fresh import of sanitized Postman exports; validate hosted access through judging, credit expiry/budget and no embedded secrets; record actual sponsor usage and recheck prize rules. | Included in prioritized totals; owner approvals/wait time extra |

- [ ] S1: Postman collections/environment template import and assert real contracts; shared exports contain no secrets or saved payer responses.
- [ ] S2: Render offer eligibility, expiry, budget and paid persistent-state plan confirmed before provisioning.
- [ ] S3: Hosted runtime passes auth/CSRF, callback approval, storage/restart and no-duplicate-payment checks; local setup retained.
- [ ] S4: APIMatic optional evaluation accepted with evidence or rejected without blocking core delivery.
- [ ] S5: AG Studio optional evaluation accepted with applicable public-demo/judging license terms or rejected in favor of native UI.
- [ ] S6: P4 claim/reproducibility review reflects only integrations actually used. No eligibility or award guaranteed.

These items are not completed by documentation. Add **1.5–3 developer-days** prioritized tooling/deployment to the original 12–18-day core estimate: **13.5–21 days** before optional evaluations. APIMatic+AG evaluation adds up to one day total; adopting AG adds another 1–2 days. Do not silently fit these into the existing dates. If schedule pressure rises, reject optional integrations first and simplify presentation; never weaken accounting/verification. Check credit/trial coverage through judging, not just submission; retain a working local path if the hosted plan is blocked.

## Blockers, risks and controls

| Risk or dependency | Current status / mitigation | Owner / gate |
| --- | --- | --- |
| Implementation authorization | Owner explicitly authorized completing P1; implementation and minimum live model gate complete; P2 not started | Developer, P1 gate |
| AI endpoint/model and costs | Owner configured model/key; deepseek-v4-pro live verified, eight-call task bound retained | Owner configuration + developer live verification |
| SQLite native package support | better-sqlite3 12.4.1 native binding tested on local Node 20.19.2; Render/Linux remains unverified | Developer, hosted gate |
| Semantic service quality | Schema/anchors are limited objective evidence; independent review is not truth proof | Developer, P1.6; expose limitations |
| Financial concurrency / crashes | JSON P0 insufficient; SQL constraints, append-only events and durable intents required | Developer, P1/P2 |
| Payment retention / unknown create | Stable operation IDs, five-hour cutoff, manual investigation instead of new order | Developer, P2 |
| Human approval availability | Owner must approve live Sandbox runs; cannot be automated away | Owner, P2.5/P3 gate |
| Public repository access/rate limits | Pin known public fixture revision and bounded cached artifacts; log unavailable evidence honestly | Developer, P1.4 |
| Schedule overrun | Ship one useful vertical loop; defer optional auth-capture, webhook ingress and UI elaboration | Owner/developer, each phase |
| Publication and licensing | Independent project Git repository now established; private remote weihong363/credence. Public release and license remain pending; never publish the ancestor/home repository | Owner, P4 |

## Workflow and reporting

For every authorized slice: read current authority → confirm prerequisites → implement smallest vertical change → meaningful tests/type checks → phase acceptance → update checkboxes/evidence/limitations. Continue within an authorized phase only after its slice passes. Do not proceed to a later phase with a failed financial invariant. Report live versus mocked evidence separately. P1 local implementation and offline checks are complete; minimum live gate also passes in [p1-verification.md](p1-verification.md). P2 remains a separate next phase. Render deployment remains deferred pending billing setup.

## Documentation audit result

On 2026-10-21 this documentation-only task inspected the current source, package scripts, tests, verification runner and existing evidence JSON. `pnpm check` passed; `pnpm test` passed all 18 local mocked tests. Local Markdown link targets and balanced code fences were checked. No new Sandbox request, credential inspection, database migration, dependency installation or P1–P4 source implementation was performed. Official competition schedule/rules were read separately; they do not establish completion of any publication task.

## P0 Render preparation follow-up

See [deployment-render.md](deployment-render.md). This is an owner-authorized hosting preparation slice, not P1/P2 or a claim that the complete console exists.

- [x] Actual stack mapped: native Node API, no Java/frontend/SQL/LLM components.
- [x] Native Node Blueprint, one paid single instance plus persistent JSON disk; auto-deploy/previews off.
- [x] Backend build/start, trusted HTTPS origin, assigned PORT/HOST, DATA_DIR, Sandbox-only base URL and public health endpoint.
- [x] Bearer auth retained; foreign Host/Origin rejected; callback binding/capture verification retained; graceful drain/restart tests.
- [x] Empty production configuration template and Docker ignore rules; no runtime dependency added.
- [ ] Review/commit/push prepared files; verify intended existing resources to avoid duplicates.
- [ ] Approve Render billing/region/resources and deployment; connect private GitHub repository and enter secrets.
- [ ] Resolve safe fixed-bill state transfer before hosted financial mutations.
- [ ] Verify real hosted health/auth/PayPal approval/capture/persistence and record new evidence. Local tests do not count as hosted verification.

The prepared resources cover only P0 API hosting. P3 frontend/owner sessions/mission controls and full runtime deployment remain planned. No Static Site, PostgreSQL, workflow worker or LLM account should be provisioned for nonexistent components. Schema validation does not validate account entitlement or perform a deployment.

## P1.1 implementation evidence

Local automated evidence: integer USD bounds/formatting, WAL/FULL/foreign-key configuration, migration replay, two independent processes competing for limit 100 with reserves 70/40, unchanged replay, changed-payload conflict, purchase uniqueness, immutable ledger/audit triggers, owner/policy/deadline/budget denial, and injected audit failure with complete rollback. Checks: `pnpm check`, `pnpm test`, `pnpm test:production`. No live PayPal/LLM request or Render deployment. This is an internal foundation, not full procurement or accepted service charges; staged schema limits are in ADR 0007.

## P1 implementation evidence (current)

See [P1 verification](p1-verification.md) and [ADR 0008](decisions/0008-p1-local-procurement.md). Registry/quote policy, durable execution, source snapshots, bounded model adapter, correction/verification, reserve/release/accepted-charge transactions and cited mission synthesis are implemented. Native model transport and complete procurement are tested offline with explicit mocks; final suite 56/56 passes, type/build/production smoke checks pass. GitHub source inventory is live verified; DeepSeek minimum live procurement/report is also verified. `pnpm mission`, `pnpm economy` and `pnpm verify:source` are implemented commands. No P2 payment integration, Render resource or frontend was added.
