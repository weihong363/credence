# P3 implementation and verification

Current status (2026-10-23): P3.1–P3.3 and the bounded mission/result controls are implemented and deployed. Five consecutive browser-only real procurement/Sandbox settlements pass. Broader mobile/accessibility acceptance remains pending. Dated sections below preserve the status at each checkpoint. P2 was committed/pushed separately as `9c57e46` before these changes.

## P3.1 owner authentication

| Request | Input | Result |
| --- | --- | --- |
| POST /api/session | Exact same Origin, application/json `{ownerToken}` | HttpOnly session Cookie; JSON `{authenticated, csrfToken, expiresAt}` |
| GET /api/session | Valid session Cookie | Current CSRF token and fixed expiry; never owner/session credential |
| POST /api/session/logout | Cookie, exact Origin, X-CSRF-Token | Server revocation plus Max-Age=0 Cookie |

Sessions last one hour without sliding renewal. HTTPS uses `__Host-credence_session`, Secure, HttpOnly, SameSite=Strict and Path=/; loopback HTTP uses `credence_session` without Secure. The configured PUBLIC_URL determines policy, including behind a TLS proxy; untrusted forwarded headers cannot downgrade it. Twenty failed credential checks trigger a 60-second process-local throttle; active session count is bounded at 100. Duplicate/forged cookies fail closed. Constant-time byte-safe credential comparisons handle Unicode without throwing a length exception.

Login rotates the presented prior session. Logout, expiry and process restart invalidate old cookies; restart does not reset economic state. An invalid Authorization header never falls through to a valid cookie. Existing Bearer CLI calls retain their P2 contract and do not create browser sessions. Every cookie-authenticated mutation, including existing batch/payment APIs, requires exact Origin plus the session-specific X-CSRF-Token before body handling or financial writes. JSON bodies remain capped at 8 KiB.

No UI exists in this slice. Future UI must clear the owner credential after login, retain CSRF only in memory, use same-origin fetch, and handle 401 by asking the owner to log in again. Do not put owner tokens, payment credentials or session IDs in localStorage/sessionStorage, URLs, model inputs or application logs. Callback URLs keep their separate one-time capability; they cannot authorize capture or clear a cancellation latch.

## Sanitized read APIs

All routes require a valid owner session or the existing owner Bearer credential. The runtime still enforces a single owner and exact Host/any supplied Origin. A missing or inaccessible task/account returns 404.

| Request | Projection |
| --- | --- |
| GET /api/tasks | Paged task ID/status/profile, objective, budget/spent/deadline, purchase/accepted counts and current outstanding |
| GET /api/tasks/:id | Same metadata for one owned task |
| GET /api/events | Paged owner-scoped committed audit events |
| GET /api/tasks/:id/events | Audit events linked through that task's reservation or frozen allocations; a batch event appears once |
| GET /api/accounts/:id/ledger | Current owned account balances/policy plus paged financial events |

Page parameters: `afterSeq=0`, `limit=50` by default; maximum 100. Reject negative, fractional, exponent, unsafe, duplicated or unknown query fields. Responses use `{items,nextSeq,hasMore}`; ledger wraps this under `entries` alongside `account`. Times are UTC epoch milliseconds; amounts are integer USD minor units. Cursor belongs to that endpoint: task list uses its existing rowid sequence; audit and ledger use their own append-only seq values. Do not interchange cursors or reuse one across different task filters.

For event polling, request `/api/events?afterSeq=LAST_SEQ&limit=50` approximately once per second in the later console. Consume returned entries in seq order; update the cursor only after a successful response has been processed. Drain hasMore pages before sleeping. Empty pages retain the prior cursor; errors do not advance it. Repeat requests are stable until new rows commit. Reads never write ledger/audit or call remote services. Account/ledger and filtered audit projections use read transactions for a coherent snapshot.

Only explicit columns are serialized. Raw task input/result, source/model/provider payloads, input/output/payload hashes, dedupe/PayPal request keys and callback secrets are absent. Audit types and reason codes are allowlisted; free-form correction reasons and unknown provider messages are not echoed. Task objective is owner-authored display metadata, not the model prompt; later UI must render it as text. Full reports, delivery evidence and mission reasoning views belong to P3.2/P3.4.

Existing economic_audit records do not include every planning/task-terminal transition. The cursor exposes actual committed events rather than inventing history; current task status must also be read. P3.2 will add missing observable workflow transitions where needed. No schema migration or historical row rewrite is required here.

## Local acceptance

```sh
pnpm check
pnpm test
pnpm test:production
```

Recorded result: **105/105** automated tests pass, type check passes, compiled build and production smoke pass, and `git diff --check` passes. No live PayPal or LLM request was made for P3.1. All new financial HTTP tests use mocked transport and temporary SQLite.

- Unit checks: fixed expiry; random/secure cookie attributes; CSRF/Origin; re-login rotation; logout/restart revocation; forged/duplicate cookie rejection; invalid Unicode credentials; throttle expiration.
- HTTP checks: login rejects foreign/missing Origin and bad credentials; API never returns owner/session secret; cookie payment mutations without correct CSRF make zero SQLite writes and zero remote calls; valid session and Bearer paths work; expired/logged-out/rotated cookies return 401; cursor and ownership validation; task/audit/ledger secret-safe projections.
- Read checks: strictly ordered, stable, incremental, bounded pages; task-linked batch event without duplicates; known reason codes retained, private canaries and free-form text filtered; no SQL writes; independent financial reconciliation still passes.
- Compiled process smoke: simulated HTTPS proxy produces Secure __Host- cookie; session reads work; missing-CSRF logout fails; restart rejects prior cookie while preserving SQLite account; fresh login/logout succeeds. This is HTTP/process testing, not browser-UI or live hosting acceptance.

P2's real payment evidence remains [unchanged](p2-live-evidence.json). No new payment, allowance adjustment, task/model run, cloud resource or deployment was initiated. The product console, browser interaction acceptance and five consecutive real procurement/payments are still unverified and are not marked complete.

## Render source/deployment separation

On 2026-10-23 the owner-created Render service was checked read-only: P2 commit 9c57e46 is live, public health is 200, unauthenticated API access is 401, and 1 GB disk configuration is present. Automatic deployment is off. This P3.1 commit/push does not deploy it. Cloud owner initialization, actual ledger persistence and P3 browser/session acceptance remain pending. See [readiness record](render-readiness.md).


### Cloud deployment follow-up

Owner-authorized manual deployment `dep-dbdcccbncjis739n0o50` became live on 2026-10-23 at 02:28:44Z, serving P3.1 commit `9fec52c` on the existing service. Public health returned 200; unauthenticated economy/session reads returned 401; missing/foreign Origin session POSTs returned 403. No authenticated login, cloud initialization, model task or payment was performed. Full cloud session and persistence acceptance remain pending; see [deployment evidence](render-readiness.md).

### Explicit operator initialization follow-up (local only)

Prepared `node dist/admin/initialize.js 1500` and `node dist/admin/verify-session.js`; see the Render guide. Initialization is an application transaction with safe replay, allowance conflict rejection, partial-state refusal and rollback tests. It does not create economic obligations. Local validation: `pnpm check`, `pnpm test` **108/108**, `pnpm test:production` and `git diff --check` pass. The first restricted test attempt failed only because local HTTP listeners were denied; rerunning with listener permission passed the complete suite. Cloud execution is pending Render Shell access and deployment of these commands; the live service still serves `9fec52c`.

Cloud execution follow-up (2026-10-23): `fc22938` is deployed live. Explicit 1500-unit initialization and identical replay succeeded on the existing persistent-disk database. Cloud session acceptance **failed** (login 401); configuration parity requires further authorized diagnosis. No model or payment was initiated. See [current execution record](render-readiness.md#cloud-initialization-execution--2026-10-23). Local 108/108 tests remain distinct from this failed cloud acceptance.

Cloud session acceptance now **passes** following owner credential update and manual deployment `dep-dbdcrp4s728c73bgabgg` (live, same `fc22938` source). HTTPS login, cookie-authenticated session/economy/tasks, missing-CSRF rejection, logout and revoked-cookie rejection all returned expected statuses. The same initialized account survived redeploy with 1500 available, zero reserved/outstanding and no charges. This is API session/persistence acceptance, not browser UI or full mission/payment acceptance; see [latest evidence](render-readiness.md#session-and-post-redeploy-persistence-acceptance--passed).

## P3.2 local read-only console acceptance

Implemented same-origin owner login/logout and session restore, mission list and selection, saved plan reasons and quote prices, provider identity, reservation/purchase/delivery status, validated evidence disclosures, committed activity cursor polling, empty/error handling and session expiry handling. The console does not start missions, adjust Credit, freeze batches, approve or capture payments. Final reports and financial controls remain later slices.

`GET /api/tasks/:id/activity` checks task ownership before loading data in a coherent transaction. Its explicit projection excludes raw task/provider result JSON, prompts, source snapshot payloads, invocation leases and payment request keys. Only exact source anchors from a PASS delivery matching the hashed snapshot are displayed, bounded to 30 anchors per delivery and 4000 characters per anchor. Failed/omitted anchors are not presented as verified. Plan reasons are persisted concise justifications, not model chain-of-thought. UI renders all values through textContent, never innerHTML.

Local checks: `pnpm check`, `pnpm test` **110/110**, `pnpm test:production` (backend + Vite build and compiled process checks), `git diff --check`. New integration tests verify owner isolation, no writes/replay, three accepted services and evidence projections, public static shell/CSP, allowlisted assets, secret canaries absent from HTML, protected activity route/query validation and zero payment calls. Vite 6.4.5 is build-only; env-file loading/public asset copying/source maps are disabled. Existing financial tests remain passing.

Manual browser acceptance used an in-memory test fixture from paymentFixture, fake owner credentials and mocked source/model/payment transport on localhost:3198; no `.env` or live account was used. Login succeeded; one COMPLETED full-review task showed three accepted services totaling USD 7.50 (1.25/2.50/3.75), provider B/B/C, saved reasons, consumed reservations and PASS attempts. Expanding architecture evidence showed package.json:1 and index.ts:2 exact fixture anchors. Expansion remained intact over polling, browser reload restored the session, and Sign out returned to the login form. These are simulated browser observations, not additional real procurement/payment evidence.

Reproduction: `pnpm build`, `pnpm dev`, open the configured local origin and enter that server's owner token. Inspect existing tasks; an empty account honestly shows no missions. Select a mission and open each delivery disclosure; refresh/reload and sign out. Login secrets must never go in URLs, storage or screenshots. Public Render still serves `fc22938` without this UI until a separately authorized source push/deployment. P3.3, P3.4 and the five-real-run gate remain pending. Desktop/mobile layout and additional failure-state exploration can be broadened during P3.4; current browser observation was a narrow viewport.

## P3.3 local financial UI acceptance

Implemented balance/purchase-cap policy display, charge selection and explicit freeze, immutable batch/charge breakdown, paged append-only ledger, Sandbox approval link, order/capture/reconcile/cancel/resume buttons with state-specific guidance. Financial mutations use existing P2 services; no automatic capture, policy adjustment or replacement billing. Approval links open a separate tab with noopener/noreferrer. Capture requires inspected APPROVED, a review disclosure showing amount/batch/order, and an explicit second click. Cancel is labeled no refund. Reconciliation is available for known orders; unknown create without an ID instructs investigation. Browser command identities are reproducible across reloads, CSRF is memory-only, actions disable pending, and stale state is rejected server-side. Ledger cursors deduplicate overlapping responses; allocation events resolve their actual batch at read time.

`GET /api/finance` is authenticated/owner-scoped and excludes raw payment JSON, internal provider-operation keys, callback state, hashes and merchant configuration. It returns authoritative account/policy projections, eligible-charge flags, batch allocations, allowlisted inspection status and verified receipt metadata. Captured/settled status is not inferred from redirects or buyer clicks. Read transactions are side-effect free.

Checks: `pnpm check`; `pnpm test` **115/115**; `pnpm test:production` including build; `git diff --check`. New tests cover unchanged/replayed read snapshots, owner isolation, locked eligibility, receipt sanitization, deterministic command keys/version/charge order, CSRF denial, stale capture denial, simultaneous/replayed HTTP capture with exactly one remote mock capture and PAYMENT_CONFIRMED, decline/cancel/unknown projections, lost-capture reconciliation, repeated freeze on fresh charges and refusal to reallocate. Existing competing-process financial concurrency, rollback and reconciliation coverage remains passing.

Manual browser acceptance used only an in-memory paymentFixture and mock source/model/payment ports on localhost:3198. The fixture had one independently simulated APPROVED order for three charges totaling USD 7.50 and a USD 10.00 allowance. Login showed 7.50 outstanding/2.50 available, three locked allocations and APPROVED. Opening Review capture and clicking Capture invoked the mock adapter; the UI then showed SETTLED, ORDER1/CAPTURE1, zero outstanding/10.00 available, and a ledger with one PAYMENT_CONFIRMED plus three CHARGE_SETTLED rows. No actual Sandbox approval link was followed, real payment initiated or `.env` loaded. This rehearsal does not count toward the five-real-run gate or replace P2's historical payment evidence.

Manual real flow after approved deployment: use the correct deployment's owner session; inspect the charge set and freeze total; create its one order; have the human buyer approve on PayPal Sandbox; reconcile to independently establish approval; review and explicitly capture; reconcile the displayed receipt, allocations and balances. For cancellation or network loss, retain the same batch and reconcile; never start a replacement payment. No real run has been authorized/performed in this slice. All P3.2/P3.3 source remains local until a separately authorized commit/push/deployment. P3.4 and complete P3 acceptance remain pending.

## First P3.4 slice — local result/failure presentation and rehearsal

P3.2/P3.3 were committed/pushed as `2db1769` and deployed live to the existing service; public shell/JS/health, authenticated finance and login/logout checks pass. Cloud account remains limit/available 1500 with zero obligations. [Deployment evidence](render-readiness.md#p32p33-deployed--2026-10-23). No cloud model or payment was invoked.

Subsequent P3.4 source adds the owner-protected result endpoint and explicit bounded projection. Tests reject foreign-owner reads, extra result fields, changed revisions, foreign delivery citations and arbitrary failure reason payloads; reads produce no writes. Complete reports cite the same task's accepted deliveries and cover all of them. OPEN/failed/unavailable views never pretend success. Existing financial tests and historical payment evidence remain intact.

Local checks: `pnpm check`; `pnpm test` **118/118**; `pnpm test:production` including backend/browser build; `git diff --check`. Six rehearsal scenarios are tested with global fetch disabled to detect accidental network transport. The CLI accepts only named scenarios, creates in-memory state and explicit fake configuration, binds 127.0.0.1:3198 and marks served HTML SIMULATED REHEARSAL. It does not load .env or compile into the production server. Start `pnpm rehearse:console ready|empty|settled|declined|unknown|action-required` (one scenario argument), log in with its printed fake token and stop before switching scenarios.

Browser observations: ready scenario displayed a COMPLETED 3/3 full review, recommendation, pinned revision, mock summary, three accepted-delivery citations and limitations. Replacing the rehearsal process invalidated its cookie and returned the browser to login. In action-required scenario, task showed ACTION_REQUIRED 2/3, reason REQUIRED_SERVICE_NOT_ACCEPTED, no final success report, accepted inventory/architecture charges totaling 375, rejected risk-review with released hold and FAIL attempts without evidence anchors. English recovery copy warns that accepted services remain payable and terminal execution cannot be resumed. This is mock-only presentation acceptance, not semantic model-quality or real procurement/payment proof.

P3.4 as a whole remains **incomplete**: browser task creation/execution, full failure/keyboard/mobile/accessibility acceptance and real controlled-run orchestration still need their own slice. Five consecutive real same-task-three-service/Sandbox settlements remain unchecked. No new real task or payment is authorized by this rehearsal. P3.4 source and this deployment follow-up are local/uncommitted, while Render serves `2db1769`.

## Controlled task entry and recovery acceptance (local)

Owner requested completing acceptance before continuing. The next vertical slice implements real owner task-start/resume endpoints and browser controls, with no automatic new task/capture. Tests now total **124/124**; type check, backend/Vite build, compiled production checks and diff checks pass. Additional tests prove durable same-key replay, payload conflict, exclusion through another SQLite connection, creation rollback, missing-model/credit rejection before task/model spend, expired-worker fencing, unchanged original deadline, terminal replay without extra calls, expired-task zero-source/model execution, immutable request history, authenticated/CSRF strict HTTP start, and authentic v7 procurement history preserved through v8 migration.

Browser rehearsal starts from an empty in-memory account. Keyboard Return submits login; Space expands the start disclosure. After filling the pinned public mock repository and explicitly authorizing model/internal spending, one task completes with three accepted deliveries and a cited report, 750 outstanding and no payment. Task rows preserve focus during replacement; disclosures support Space and retain expansion across polling. At the observed 1265 CSS-pixel viewport, document scrollWidth equals clientWidth (no horizontal overflow). The available browser did not apply a zoom shortcut; no new mobile-device or formal WCAG audit is claimed. Earlier narrow-viewport observations remain limited to their dated slice. API/process tests cover session expiry/restart and financial failure/unknown recovery; those are distinct from a full assistive-technology audit.

Render LLM variables were initially absent. The owner confirmed configuring them; a subsequent boolean-only SSH check confirmed all three are present. Before schema upgrade, an existing-disk backup `backups/pre-mission-schema-v8.sqlite` was created mode 0600 without exporting state or running a second payment authority. Cloud was still schema v7 with zero tasks at that checkpoint. Live task/payment acceptance follows deployment; five consecutive clean UI runs remain unverified until individually recorded, including each human buyer approval. No completed gate is inferred from these mocked tests.

## Hosted real API acceptance — awaiting buyer approval

Released/pushed `074a789` and deployed to the existing Render service as `dep-dbdfve1srm7s73bkc95g`, live at 2026-10-23T06:34:14Z (14:34 Asia/Shanghai). Schema v8 and enabled mission configuration were verified; account limit/available remained 1500 before execution. A fixed start key created one real full-review task for expressjs/cors at the previously verified pinned commit. The task completed using deepseek-v4-pro, four model requests, three accepted first-attempt deliveries (125/250/375), verified source anchors (1/3/7) and a three-finding cited final report. No mock transport was used in this hosted flow.

Task `db6f7792-78ae-433f-80f9-b50a3c4e4ff5`; batch `3d256de7-f9e6-4f98-825c-d993a9260474`; order `5KC26856DG778392J`; gross USD 7.50. Start/freeze/order replay retained all IDs, four model calls, three charges and one payment attempt. Capture attempts and settlement receipts are zero. An independent authenticated PayPal GET matched the amount, receiver and batch, returning CREATED / PAYER_ACTION_REQUIRED. Human Sandbox Personal approval was requested; capture/finalization/settled replay remain pending. See [sanitized live evidence](p3-live-evidence.json).

This verifies hosted real procurement and the owner API control path, **not** the five consecutive browser-only paid-run gate. It was started through owner HTTP calls over SSH and must not be counted as a complete no-console-intervention demonstration. Counter stays zero. No second task or replacement payment is started while approval is pending. Historical P0/P1/P2 evidence is unchanged.

### Human-approved settlement and redeploy acceptance — passed

The owner confirmed buyer approval. A fresh independent PayPal GET verified APPROVED; owner server Capture used expectedVersion 2 and the original batch/order, then independent GET confirmed COMPLETED with capture `89W32382PM698405E`, USD 7.50. The server recorded SETTLED and the matching immutable receipt. Capture/order replay retained one payment attempt, one Capture attempt, one PAYMENT_CONFIRMED event, three CHARGE_SETTLED events and one receipt. Available Credit returned to 1500; reserved/outstanding are zero; model requests remained four.

For process/disk continuity, the exact same commit was manually redeployed (not the separate Render restart API): deployment `dep-dbdg3fbncjis73a37g8g` became live at 2026-10-23T06:42:45.913134Z. After redeploy, the original capture command replay returned HTTP 200 and the same capture ID. Read-only database reconciliation passed with one task, four model calls, one capture and the same balances/financial event counts. There was no automatic task rerun or second capture.

This completes the first hosted real API procurement/settlement/redeploy slice. It does **not** complete the separately required five consecutive browser-only demonstrations: its initiation/control used owner HTTP calls over SSH. Counter remains zero. The online console was opened for the owner to log in without sharing OWNER_TOKEN with the assistant; subsequent runs must use UI start/settlement controls and individual human buyer approvals. No new run is started before that handoff.

The live public login was also observed at a 368 CSS-pixel viewport: document clientWidth and scrollWidth both 368, no horizontal overflow and visible labeled password field/submit control. The empty login-page screenshot contains no credentials. Authenticated narrow-viewport pages remain part of the upcoming UI gate. The live tab was retained for owner login; the local mock rehearsal process was stopped.


## Five consecutive hosted browser-only runs — 2026-10-23

**5/5 complete** on application commit `074a789`, using the same persistent Render database. Each task reviewed `expressjs/cors` at `5317ebe670db2aaebc1d496eb5d33493deefb3ed`, accepted inventory/architecture/risk services for 125/250/375 minor units, produced a report citing those three accepted deliveries, froze its own USD 7.50 batch, and settled its own human-approved Sandbox order. All task starts and financial mutations used the authenticated console UI. Read-only SSH/database checks and fresh authenticated PayPal GETs supplemented UI evidence; no financial rows were edited and no developer-console financial commands were used.

The five independent GETs returned order/capture COMPLETED, correct batch, USD 7.50 and the configured merchant. Every batch has one create attempt, one capture attempt, one receipt, one PAYMENT_CONFIRMED and three CHARGE_SETTLED events. Final account: limit/available 1500, reserved/outstanding zero. Full task/batch/order/capture IDs, receipt timestamps, delivery citations and anchor counts are in [sanitized UI evidence](p3-ui-live-evidence.json). The earlier API-only smoke is excluded from this count.

Run 2 architecture delivery initially failed with zero anchors; its bounded correction passed with six anchors and produced only one accepted charge. Run 1 owner session expired while waiting for approval; the owner re-authenticated, and the same task/batch/order completed without rebilling. A duplicate account option after re-login was observed; both options identify the same account. This minor UI issue and broader mobile/assistive-technology acceptance remain open. These runs establish repeatability on one pinned repository, not general semantic-quality assurance or a formal accessibility audit. P4 has not started.

This acceptance changed documentation/evidence only. Source checks previously passed: `pnpm check`, `pnpm test` (124/124), `pnpm test:production`. No new source-test claim is inferred from these live runs.


## Re-login regression and responsive/keyboard follow-up — 2026-10-23

Fixed `MissionForm.refresh()` to replace the account option list before loading a fresh session's accounts. Previously `clear()` reset the loaded flag while retaining the old options, so re-login appended duplicates. Local mock-only browser acceptance confirmed one option before logout and one after re-login without reloading the page. No financial logic changed.

The isolated `settled` rehearsal was used, with fake credentials and no real model/PayPal transport. Keyboard Return submitted login; Space toggled the task-start disclosure and selected the completed mission. The focused mission button remained visible with its focus outline and `aria-pressed=true`. At the actual observed narrow viewport of 360 CSS pixels (375 requested; host-reported content width 360), document scrollWidth equalled clientWidth; the desktop observation was 1265/1265. The narrow screenshot showed wrapped task IDs, a single-column layout, readable report content and no horizontal overflow. Temporary viewport override was reset afterward.

`pnpm check`, `pnpm test` (124/124), and `pnpm test:production` passed. The initial restricted test run failed in HTTP-listener tests; rerunning with local-listener permission passed. This is basic responsive/keyboard acceptance, not physical-device testing, screen-reader verification or WCAG certification. The one-line fix is local and not deployed; the five-run live payment evidence belongs to the unchanged prior deployment. No extra real task or payment was initiated for this follow-up.


## Owner-reported Chrome compatibility acceptance — 2026-10-25

Owner confirmed all items in the Chinese Chrome emulation checklist passed: six portrait sizes and landscape, existing task/report/evidence and settled-payment views, account selection, logout/re-login/refresh, keyboard controls, focus stability and 200% zoom. See [scope and limitations](p3-device-accessibility-checklist.md#owner-reported-chrome-acceptance--2026-10-25). Chrome version and host OS were not provided; results are owner-reported. Physical-device and actual screen-reader checks remain unverified. No implementation change, new payment, deployment or P4 activity followed from this report.

## P3 phase closure — 2026-10-25

Owner accepted deferral of physical-device and screen-reader testing and authorized P4 materials preparation. P3 closes with five real browser-only settlements, local automated checks, and owner-reported Chrome compatibility acceptance. Deferred environments remain unverified. No new payment is needed to close this phase.
