# Sponsor resources and integration decisions

Reviewed **2026-10-21**, against official hackathon resource pages and linked vendor documentation. This is a documentation decision, not an installation, credit claim, paid-plan purchase, prize entry or proof of integration. [Roadmap](roadmap.md) schedules work; [spec](spec.md) controls architecture. **P0 source, dependencies, credentials and historical payment evidence remain unchanged.**

## Scope and evidence labels

Prioritize Render for public demo hosting and Postman for reproducible API verification. These support building/testing/deploying the MVP; neither replaces its economic core. Limit optional additions to **two candidates: APIMatic Context Plugin and AG Studio**. Evaluate them under time caps; neither is required for phase acceptance. All six other sponsor tools are deferred until a concrete product need justifies reopening the decision.

- **Published/verified** means the cited public page states the benefit or condition; it does not mean this team redeemed it or tested compatibility.
- **Conditional** means signup, approval, usage, license terms, expiry or a winner decision applies.
- **Unconfirmed** means the resource does not establish the team's entitlement, complete terms or technical suitability. Do not treat silence as permission or free unlimited usage.
- Effort estimates below are Credence planning estimates, not sponsor commitments. All work remains unchecked. No sponsor benefit changes the meaning of Credit, verification or human consent.

## Decision matrix

| Sponsor / official resource | Decision and fit | Published access / conditions | Prize position and unknowns | Incremental effort / adoption gate |
| --- | --- | --- | --- | --- |
| [Render](https://paypalaihackathon.devpost.com/details/render) | **Prioritize**, P3 deployment / P4 access; host existing monolith | Advertises **$50 credits** through linked claim portal; credit balance applied to usage billing. Not claimed. Expiry, account eligibility and covered charges not confirmed. | Rules list Render awards; actual use and general eligibility required. Hosting is the proposed use; no award guaranteed. | **1–2 days** for HTTPS/config, persistent storage, build/start, auth and restart smoke tests. No Workflows migration. |
| [Postman](https://paypalaihackathon.devpost.com/details/postman) | **Prioritize**, P1 API contracts, P2 Sandbox checks, P4 reproduction | Free signup and official PayPal collections are linked. No special paid subscription or hackathon trial promised. | No Postman-specific award listed in the reviewed rules. Account/runner/cloud limits still apply. | **0.5–1 day** for exportable collections, local-variable template and assertions; retain Node tests. |
| [APIMatic](https://paypalaihackathon.devpost.com/details/apimatic) | **Evaluate optional #1**, developer context for P2 adapter accuracy | PayPal context advertised without extra APIMatic credentials. Qualifying plugin users can claim **one month Basic**; winning plugin users can claim **six months Business**, subject to verification. | APIMatic award exists; no retroactive claim that P0 used it. Claim and prize eligibility are separate. | **2–4 hours** evaluation in P1 planning/P2 preparation; adopt only if actual Codex/TypeScript context adds accuracy without replacing native fetch. |
| [AG Grid / AG Studio](https://paypalaihackathon.devpost.com/details/aggrid) | **Evaluate optional #2**, P3 read-only financial/activity visualization | Sponsor advertises **45-day trial**. Enterprise product, not an assumed permanent free library. | AG Grid awards exist; resource emphasizes polished Studio dashboards and agent framework, not just a plain table. License/public-demo permission unresolved. | **Up to 4 hours** evaluation; **1–2 days** additional adoption/polish if approved. Keep vanilla TypeScript; no framework rewrite. |
| [Astropods](https://paypalaihackathon.devpost.com/details/astropods) | **Defer**; separate hosted agent runtime duplicates local jobs/providers | Free account linked; declarative spec/CLI deployment described. No quantified duration, quota or durable free-hosting entitlement established. | No dedicated award listed in reviewed rules; service terms remain applicable. | No scheduled work. Reopen only if local runtime demonstrably cannot meet an approved need. |
| [Elastic](https://paypalaihackathon.devpost.com/details/elastic) | **Defer**; ledger lookup does not require search/vector infrastructure | **14-day trial**, resource offers form-based self-extension by **30 days**; local free option linked. No team extension redeemed. | No dedicated award listed. Cloud feature limits and chosen distribution's license must be checked if reconsidered. | No scheduled work. SQLite remains financial authority even if a future search index is added. |
| [KERNEL](https://paypalaihackathon.devpost.com/details/kernel) | **Defer**; remote browsers are not needed for public-source API work | **$50 credits** advertised; account claim/expiry/usage restrictions not established for this team. | No dedicated award listed. Session hosting is not permission for autonomous buyer approval. | No scheduled work. Never automate owner financial consent merely to use the sponsor. |
| [Bryntum](https://paypalaihackathon.devpost.com/details/bryntum) | **Defer**; no scheduling/resource-planning requirement | **45-day trial**, commercial component family; evaluation is not an open-source redistribution grant. | Bryntum award exists; requires actual component use. Public hosted trial permission must be resolved before adoption. | No scheduled work; no Gantt/calendar added solely for the award. |
| [Channel3](https://paypalaihackathon.devpost.com/details/channel3) | **Defer**; product-shopping data is unrelated to repository capabilities | Signup/key, no card; promo **PAYPAL-HACKATHON-2026** advertises **20,000 API credits**. Resource offers requested top-ups; not an unlimited entitlement. | Channel3 award exists; meaningful API/MCP calls required, merely mentioning it is insufficient. | No scheduled work; do not change demo domain to consume credits. Data/API terms remain separate from app licensing. |
| [Zapier](https://paypalaihackathon.devpost.com/details/zapier) | **Defer**; external app actions add permission and credential scope | New accounts receive **14-day Professional trial**, no card, then Free plan. Paid features/quotas cannot be assumed after downgrade. | No dedicated award listed; connected-app authorization and plan limits still apply. | No scheduled work. Not a substitute for deterministic policy or PayPal backend settlement. |

## Priority 1: Render, with persistent financial state

The [official claim link](https://credits-portal-mmdm.onrender.com/claim/paypal-ai-hackathon) resolves to a client-rendered portal without readable claim terms in this review. Before creating services, the owner must check credited workspace, payment-method requirements, expiration, eligible service/disk usage, overage behavior and spending controls. **Published $50 is not a verified balance or a promise of a free deployment.** No claim form was submitted.

Render's [free-service documentation](https://render.com/docs/free) states that local SQLite/files can disappear on restart/redeploy and free services cannot attach persistent disks; idle services also spin down. Therefore use one paid monolith instance with persistent disk, rather than migrate to a new database solely to use a free tier. [Disk documentation](https://render.com/docs/disks) limits a disk to one instance, unavailable at build/pre-deploy time, and prevents zero-downtime deploys. Migrations must run at application startup under exclusive ownership; graceful drain/recovery is required. Keep DB, WAL/SHM and artifacts together under a configured mounted directory. Back up SQLite consistently and reconcile provider status after any restore.

This is an architectural fit analysis, not deployment evidence. At the sponsor-review baseline, P0 hardcoded loopback, localhost URL checks and relative data paths. Subsequent owner-authorized [deployment preparation](deployment-render.md) adds the minimal hosted configuration; no cloud deployment is claimed. The later runtime needs configurable port/bind, a trusted HTTPS public origin, secure sessions/CSRF, authorized callback routes, bounded public access, health checks and native SQLite build verification. Do not upload `.env`, local P0 payment state or personal artifacts. Public visitors get read-only sanitized demo data; running missions or spending requires authorized owner/session policy and rate limits.

[Pricing](https://render.com/pricing) and Render's [cost guide](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses) are usage-dependent; the guide lists persistent disks at $0.25/GB-month. Confirm the actual instance/disk quote and credit applicability before provisioning. Budget service, disk, bandwidth/build usage and AI costs independently; credits may not cover all of them. No zero-cost guarantee or paid commitment is made. Maintain review access through judging (currently December 15, 2026), not only the November submission date; confirm credits last or obtain an approved funding/fallback plan.

The sponsor page promotes Render Workflows, but the reviewed prize table says eligible submissions use Render tools; it does not separately mandate Workflows. Plain hosting is our proposed meaningful integration. Do not split the monolith, move jobs to distributed Workflows or add its SDK for prize optics. Ask organizers if additional award-specific evidence becomes necessary; hosting alone does not guarantee selection.

## Priority 2: Postman as reproducible test tooling

Use the linked [official PayPal API workspace](https://www.postman.com/paypal) as a reference, not a replacement for server-side OAuth and business idempotency. [Postman pricing](https://www.postman.com/pricing/) includes a Free individual API-testing tier; higher automation/collaboration features have different limits. No premium or unlimited-run entitlement was verified.

Planned deliverables: `postman/credence.collection.json`, an empty-value environment template and `postman/README.md`. These files **do not exist yet**. Separate folders for local P0 reference, future P1 procurement, and P2 settlement. Assert quote/policy rejection, three accepted charges, bill totals, same order/capture on retries, cancellation and unknown-state handling. Tests must use real returned IDs and explicit prerequisites, not canned green success. Export no saved responses containing payer data.

Default runner is non-mutating. Create/capture folders are opt-in, stop for manual Personal-buyer approval and require the owner to explicitly continue. Never configure a monitor or collection loop that creates payments unattended. Direct PayPal OAuth reference calls, if needed, use only local user-managed secrets/Vault and never public/cloud-synced values; normal application collections call Credence's backend. Keep Client Secret, access tokens and OWNER_TOKEN out of shared environments, collection scripts, examples and LLM contexts. Parameterize `baseUrl`; do not weaken P0's host validation for a test runner. Local Node tests remain the financial concurrency/crash oracle. CLI/CI runners are later optional tooling choices and not runtime dependencies.

## Optional evaluation 1: APIMatic Context Plugin

The [PayPal plugin catalog](https://context.apimatic.io/plugins/paypal/) lists Codex support, Node 18+, plugin version 0.4.0 and MIT licensing. This verifies advertised support, **not installation or successful behavior in this desktop session**. The sponsor's [Getting Started PDF](https://drive.google.com/file/d/1qa7Xkjt3PGJllHQVCP1IuE-XxlRNz4mN/view) did not expose readable instructions here; do not invent its setup steps. Later inspect pinned plugin source and scope its installation to the intended development environment; its advertised installer can target multiple assistants. No installer was run.

Evaluation compares plugin-assisted guidance with official PayPal Orders/OAuth contracts and P0 regression tests: payload fields, request-ID retention, capture and error semantics. Generated SDK context may differ from our native HTTP stack; reject suggestions that add SDKs, vaulting, payouts or rewrite verified transport without need. It is development context only, never a runtime agent tool or a path to payment secrets. Keep source version and concrete assisted changes as usage evidence.

The [official claim form](https://docs.google.com/forms/d/e/1FAIpQLScc2oCgAFACm7d6H3R4mgzv-O34DdyVnLIBNiwmUNggr_-hhA/viewform) requires a project/repository link showing plugin usage, verifies participant/winner status manually, ties claims to submitter email, starts subscriptions upon approval and makes them non-transferable. No automatic activation or current eligibility is assumed. MIT plugin code does not make APIMatic's subscription service free indefinitely. Evaluation succeeds only with useful verified context in this environment within 2–4 hours; otherwise use official docs and retain the current transport.

## Optional evaluation 2: AG Studio

Use [JavaScript Studio](https://www.ag-grid.com/studio/javascript/quick-start/) to assess compatibility with planned Vite/vanilla TypeScript. React is not required by that published quick start; there is no reason to switch the console framework. Potential data sources: sanitized ledger rows, reservation/outstanding/available projections, purchase activity and frozen batch breakdowns. Display integer-derived financial values; browser aggregation never authorizes money changes. Studio dashboard/agent editing, if explored, changes presentation only, never ledger records or settlement state.

[AG Studio pricing](https://www.ag-grid.com/studio/license-pricing/) advertises a 45-day enterprise trial and deployment-dependent commercial pricing. The linked [commercial EULA, clause 13](https://www.ag-grid.com/eula/commercial/) instead describes internal evaluation and a 30-day trial plus negotiation period. **These differing terms do not establish permission for a public hackathon demo or a 45-day public deployment.** Obtain applicable written trial terms covering hosted judging/reproduction and expiry before adopting; do not infer a waiver from sponsorship. Do not publish vendor bundles or license keys as open-source project code. AG Grid Community and commercial AG Studio are different products/licenses.

Time-box the assessment to four hours; adopt only if it improves causal clarity, stays within vanilla TypeScript, and resolves public-demo licensing through judging. Estimate another 1–2 developer-days for integration/polish/accessibility. Otherwise retain native tables/cards and the same backend read models. No paid license estimate can be confirmed from custom pricing; request terms before committing. Starting a trial now could expire during judging; track actual activation/expiry rather than assuming deadline coverage.

## Prize eligibility and licensing boundaries

The [official rules, sections 4 and 8](https://paypalaihackathon.devpost.com/rules) list sponsor awards for AG Grid, APIMatic, Bryntum, Channel3 and Render. Render prizes are credits, not cash. Actual sponsor-tool use and general eligibility are necessary; organizers determine winners. Only one sponsor prize can accompany one grand prize or one honorable mention. Sponsor participation is not a guaranteed award.

AG's resource favors polished Studio/agent usage, while the rules allow AG Grid tools generally; examples are not automatically mandatory. APIMatic's participant subscription is not a cash award. Maintain actual usage evidence, resolve library/service licensing independently, and recheck rules at P4. Credence currently claims neither sponsor eligibility nor redemption.

Deferred-tool licensing remains a prerequisite if reopened: [Bryntum license guidance](https://bryntum.com/products/license/) describes commercial/developer licensing; a 45-day invitation is not public redistribution permission. Astropods, KERNEL and Channel3 resource pages do not state complete service/license/expiry terms; Elastic local distributions/features must be checked individually; Zapier trial does not guarantee ongoing paid MCP features. No deferred tool gets a production-use or open-source compatibility waiver by default.

## Cost and exit decisions

| Work | Incremental engineering estimate | Financial / operational boundary |
| --- | --- | --- |
| Render deployment and recovery/access checks | 1–2 days | Paid compute + persistent disk, usage/AI extra; advertised $50 unclaimed; confirm billing and judging coverage |
| Postman collections and verification guide | 0.5–1 day | Start with Free/local testing; do not assume paid automation allowances |
| APIMatic optional evaluation | 2–4 hours | Advertised MIT plugin; subscription benefit conditional; no runtime dependency |
| AG Studio optional evaluation | Up to 4 hours; adoption adds 1–2 days | Trial/public-hosting terms unresolved; commercial price not fixed |
| Other six sponsors | 0 scheduled | Reopen only with a real unmet requirement |

Allow **1.5–3 incremental days** for the prioritized delivery/test tooling, plus **up to one day** total optional evaluation (eight-hour planning day). Optional AG Studio adoption is additional and must displace UI polish, not economic correctness. These are added to the prior 12–18-day core estimate, not silently absorbed; revise schedule once P1 throughput is known. A sponsor trial expiry cannot justify shipping a broken or inaccessible demo.

### Evidence required before marking sponsor work complete

- [ ] Render entitlement/expiry and budget verified; service/deploy URL and authorized configuration recorded.
- [ ] Persistent storage/restart/reconciliation and HTTPS callback/session tests pass on deployed runtime.
- [ ] Postman export imports cleanly with empty shared secrets; failures and replay assertions work; manual approval remains manual.
- [ ] APIMatic evaluated with versioned usage evidence, or explicitly rejected without blocking P2.
- [ ] AG Studio evaluated with applicable license/public-demo/judging terms, or explicitly rejected with native UI fallback.
- [ ] P4 sponsor claims describe actual usage only; recheck rules and service terms before submission.

No services, SDKs, collections, dependency changes, credit claims or new payments were created during this review. The original autonomous capability procurement → bounded Credit → delivery verification → human-approved aggregate Sandbox settlement loop remains the primary acceptance criterion.
