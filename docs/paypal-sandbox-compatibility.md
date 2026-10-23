# PayPal Sandbox compatibility spike

Date: 2026-10-21. Decision: core Sandbox approval/capture flow VERIFIED through authenticated PayPal API evidence. Phase 0 required settlement/negative-test checks are complete. Real network-fault drills and Activity-page cross-checks remain outside the completed evidence. Stop here before building the full Agent Runtime.

## Evidence and scope

This workspace began empty. Sandbox credentials were subsequently configured locally. Live OAuth returned HTTP 200 on 2026-10-21; tokens and credential values were not displayed. Buyer approval, order creation and capture are now verified through live Sandbox API responses; see final evidence below. Automated tests use explicitly injected fake HTTP/gateway responses; they are not evidence of a successful Sandbox payment. No success IDs are fabricated in this report. All IDs beginning ORDER/CAPTURE in tests are fixtures only.

Implemented: server-side OAuth client credentials, Orders API v2 create/get/capture, redirect approval link, protected owner API, durable fixed-bill settlement, and retry/reconciliation handling. Three immutable simulated charge entries (125, 250, 375 internal units) sum to 750 units = USD 7.50. The internal bound is 1,000 units. The conversion is an explicit local demo policy, not a PayPal Credit product. Arithmetic uses safe integer minor units and string decimal serialization; this spike supports USD only.

“Verified service” is simulated fixture data, not a real proof-of-execution system. Agent discovery, service execution, credit underwriting, multiple bills, marketplaces, payouts, splits, automatic account debits, installment loans, and interest are out of scope. One configured Business merchant receives the entire payment.

## Native versus internal capabilities

| Capability | PayPal supplies | Implemented internally / limit |
| --- | --- | --- |
| Server authentication | OAuth 2.0 client credentials and expiring access tokens | Secrets stay in server environment; token cache and renewal |
| Human consent | Sandbox personal buyer login and order approval | Owner opens returned approval URL; browser callback is never treated as proof of payment |
| Aggregate payment | One purchase unit and one receiver, Orders v2 CAPTURE | Three local charges aggregated into USD 7.50; no per-service PayPal payment |
| Payment evidence | GET order status and nested capture status/IDs | Validate merchant, bill ID, currency, exact total, one purchase unit and one completed capture |
| Idempotency | `PayPal-Request-Id` replay within PayPal retention window | Stable per-operation UUIDs, fixed bill identity, local serialization, durable checkpoints, immutable terminal receipt |
| Credit and service verification | None for this hypothesis | Simulated verified charges, 1,000-unit accounting bound and explicit currency conversion |
| Deferred settlement | Buyer-approved order capture | Local accrual precedes approval; no permission for unsanctioned later automatic payments |
| Cancellation/failure | Buyer cancellation redirect, order/capture states, API errors | Cancellation latch, UNKNOWN state, reconciliation, conservative retry cutoff |
| AUTHORIZE/delayed CAPTURE | Separate Orders authorization and Payments capture APIs | Optional feature deliberately not implemented or verified |

Official references consulted on the report date:

- [Orders API v2](https://developer.paypal.com/api/orders/v2): create, show details, authorize and capture endpoints.
- [PayPal REST requests](https://developer.paypal.com/api/make-api-requests/): Sandbox endpoint and request headers.
- [Orders create reference](https://developer.paypal.com/sdk/orders/v2/orders-create/): documents six-hour request-ID storage and optional account-manager extension.
- [Idempotency](https://developer.paypal.com/api/rest/reference/idempotency/): reuse request IDs for ambiguous POSTs; retention is finite and concurrent duplicate calls may fail.
- [Getting started](https://developer.paypal.com/api/get-started/): Business seller and personal buyer Sandbox accounts, OAuth token renewal.
- [Authorization and delayed capture](https://developer.paypal.com/v5/checkout/auth-capture/): separate optional flow; not evidence for this implementation.

## Persistence and idempotency boundary

`.data/settlement.json` stores the fixed `demo-bill-1`, its three charges, stable create/capture request IDs, first-attempt times, order ID, cancellation latch and final receipt. Atomic rename, file fsync and directory fsync persist each checkpoint before a remote mutation. The server takes an exclusive lifetime process lock; concurrent requests on that server are serialized by rejection (retry later). A crashed process leaves its lock behind deliberately. After confirming no spike server is running, remove ONLY `.data/process.lock` to restart. Never delete or edit the settlement file to retry an uncertain payment.

Different client requests cannot create another bill or inject amounts/receiver IDs. Terminal receipts are write-once through the application and survive restart. The receipt includes the order ID, capture ID, currency, total and verification timestamp; charges remain in the enclosing settlement. This is application-level immutability on a trusted local filesystem, not a tamper-proof external audit log. Back up the data directory. Disk loss, manual edits, multiple copied data directories, or bypassing the server lock invalidate the local guarantee. A production multi-instance system would require a transactional shared database and durable reconciliation; it is outside this spike.

Create and capture use distinct stable UUIDs. HTTP retries cover transport errors, 401 (renew token), 429 and 5xx, at most three attempts with short exponential backoff and 15-second request timeouts. Other HTTP failures are not automatically retried within the transport. After an error the durable state is UNKNOWN, not settled. Repeated owner calls can retry the same operation after correcting the underlying issue. The adapter does not currently honor Retry-After; stop and wait on sustained rate limiting.

For ambiguous creates, repeat POST /api/create using the same ledger within five hours of the first attempt. This is deliberately shorter than the standard six-hour Orders request-ID retention; confirm the current retention for the Sandbox app. After five hours, the implementation refuses another create indefinitely until external reconciliation. It never silently rotates the request ID. For capture, GET the existing order before retrying: a completed capture can be recovered without a new capture request. After the five-hour capture retry window, only reads/reconciliation proceed. An uncertain or expired attempt never becomes a fresh bill.

A timeout after successful capture is reconciled by a subsequent GET. A successful capture POST alone is insufficient: only a fresh authenticated GET showing a matching completed order and completed capture creates the receipt. Pending, unrecognized, failed, mismatched, and unreadable states never settle. Cancellation latches locally and prevents subsequent capture initiation; it does not void a PayPal order or undo a capture already sent. If cancellation races with an in-flight operation, retry cancellation after the operation completes, then verify. An already completed payment remains settled.

## Secure local configuration

Create a Sandbox REST app associated with ONE Sandbox Business account in the PayPal Developer dashboard. Supply its client ID, client secret, and that Business account's merchant ID through the local `.env` file, shell, or a secret manager. Do not paste the secret into chat, browser code, a URL, or a report. `.env.example` contains names only; `.env` is ignored by Git and loaded server-side by `pnpm dev` using Node’s native `--env-file` option. For a fresh checkout, copy `.env.example` to `.env` first. Generate a separate random OWNER_TOKEN of at least 32 characters. The implementation binds to 127.0.0.1:3000 and deliberately supports only `http://localhost:3000`; it cannot be configured for the live PayPal API.

Required environment names: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MERCHANT_ID, OWNER_TOKEN. PUBLIC_URL defaults to http://localhost:3000. Owner API requests use a Bearer token; no secrets are served to a frontend. No CORS permissions are enabled. Callback URLs use a random per-bill state and must carry the matching order token; callbacks only display the approval result or latch cancellation. Responses disable caching and referrer disclosure. The owner settlement endpoint exposes the callback capability to the owner only. Logs omit tokens, credentials, payer details and remote response bodies.

## Manual Sandbox verification

1. Run `pnpm install`, `pnpm check`, `pnpm test`. Fill in the configuration above in the local `.env` file, then run `pnpm dev`. Missing configuration fails before serving; no mock mode exists in the server.
2. In a terminal with OWNER_TOKEN set, create the aggregate order:

   ```sh
   curl --fail-with-body -X POST http://localhost:3000/api/create -H "Authorization: Bearer $OWNER_TOKEN"
   ```

   Expected local response: the same fixed bill, USD 7.50, an actual PayPal order ID, and `approval` URL. Open that URL in the browser. Use a DIFFERENT Sandbox personal buyer account, never the receiving Business account. Review and approve USD 7.50. Callback must return locally; if PayPal rejects this redirect configuration, record the exact issue rather than claim success.
3. After approval, explicitly trigger server capture:

   ```sh
   curl --fail-with-body -X POST http://localhost:3000/api/capture -H "Authorization: Bearer $OWNER_TOKEN"
   curl --fail-with-body -X POST http://localhost:3000/api/verify -H "Authorization: Bearer $OWNER_TOKEN"
   ```

   The server first GETs the stored order, captures only APPROVED orders, then GETs it again. Expected final state is SETTLED with a receipt containing real matching order/capture IDs. Confirm one USD 7.50 transaction in the receiver's Sandbox Activity and the personal buyer's Activity. Approval alone is not payment.
4. Repeat create/capture requests, send two parallel requests, and restart the server retaining `.data`. All successful responses must retain the original order ID and receipt; concurrent requests may return 409. Confirm exactly one receiver capture. After a forced crash, follow the lock recovery procedure above.
5. Cancellation must be tested in a separate clean test workspace/data copy created BEFORE any order, using the same one Business receiver. Do not delete an unresolved ledger. Create an order and choose Cancel in PayPal. Confirm CANCELLED and no capture. Alternatively use protected POST /api/cancel. Verify, restart and attempt capture: cancellation must remain latched. Cancellation is not a refund.
6. For failures, exercise PayPal's Sandbox negative-testing facilities where supported or a controlled network fault. Record the actual HTTP/debug evidence separately with credentials redacted. Test rejected approval/funding and confirm no receipt. Disconnect connectivity after a capture attempt; restore it and POST /api/verify then /api/capture as needed. Confirm recovery of the existing order/capture without another payment. For an ambiguous create, repeat /api/create within the retry window. Never use another request ID or clear the ledger.
7. Pending/unknown: verify repeatedly until a definitive authoritative result; do not mark a bill settled from redirects or POST success alone. Beyond the retry window, inspect existing Sandbox activity/order evidence with the Business account and reconcile manually. Preserve the ledger; the spike has no retry-window override endpoint.

## Verification record and release gate

| Check | Evidence as delivered |
| --- | --- |
| TypeScript type checking | `pnpm check` passed |
| Automated tests | 18 tests passed via `pnpm test`; all PayPal responses mocked |
| Live OAuth with Business app | VERIFIED 2026-10-21: live Sandbox OAuth HTTP 200; access token obtained server-side |
| Live aggregate order creation | VERIFIED 2026-10-21 after merchant configuration correction: local HTTP 200, PayPal order 0LX18082EW768591D, USD 7.50, PAYER_ACTION_REQUIRED |
| Personal buyer approval and cancellation | PARTIAL: buyer approval verified via live GET APPROVED; local cancellation latch observed, full cancellation UX not independently verified |
| Server capture and authoritative API confirmation | VERIFIED: order and capture COMPLETED; Capture ID 3V026169LS895662F; merchant and USD 7.50 match |
| Live duplicate/restart/failure recovery | VERIFIED duplicate requests and real server restart: identical receipt and one PayPal capture. Official Sandbox decline injection also verified; real network-loss recovery remains covered by local tests only. |
| AUTHORIZE/delayed CAPTURE | Not implemented; optional |

After performing the manual run, append sanitized timestamps, actual order/capture IDs, API order/capture statuses, amount/currency, observed merchant match, buyer/receiver Activity results, duplicate counts and cancellation/retry observations. Never include access tokens, secrets, full payer profiles or browser session cookies. The core single-receiver Sandbox settlement flow is compatible based on live API evidence. Broader operational resilience remains only partially verified. No full Agent Runtime work is authorized by this spike.

Historical configuration follow-up (resolved): correct PAYPAL_MERCHANT_ID to the Business account Merchant ID, restart the server to reload configuration, and retry the existing bill without deleting the ledger or rotating its PayPal request IDs. The local OWNER_TOKEN was regenerated because the configured value was shorter than 32 characters. Safe HTTP status and uppercase issue codes are now available in error responses; remote values and bodies remain excluded.

Sandbox retry on 2026-10-21: restarted the local server to load corrected configuration and reused the persisted bill and create request ID. PayPal returned order `0LX18082EW768591D`, status `PAYER_ACTION_REQUIRED`, amount USD 7.50, and a Sandbox buyer approval URL. At that stage buyer approval and server capture remained unverified; both were subsequently verified below. The earlier HTTP 400 is historical evidence, no longer the current blocker.

Buyer follow-up on 2026-10-21: authenticated PayPal GET for `0LX18082EW768591D` returned `APPROVED` with no captures. The local ledger has `cancelled: true`; protected capture/verify returned CANCELLED and no capture was initiated. At that stage buyer approval was verified and payment completion remained unverified; completion was subsequently verified below. Resuming this previously cancelled bill requires explicit owner intent; do not silently remove the cancellation latch or create a replacement bill.

## Completed live settlement evidence

On 2026-10-21 the owner explicitly confirmed resuming and capturing this previously cancelled bill. The protected POST /api/resume now requires a matching authenticated PayPal APPROVED order before clearing the cancellation latch. It preserves the original bill, order ID and payment request keys, records resumedAt, and retains cancelledAt when available. Earlier cancellations made before timestamp recording was introduced are evidenced by the historical observation above. Resume alone never captures; capture remains a separate owner operation. Normal create/capture/verify calls cannot clear cancellation. Tests cover both explicit resume and rejection without PayPal approval.

- Owner-authorized resume: 2026-10-21 16:27:44 Asia/Shanghai (08:27:44 UTC).
- Successful capture and GET verification: 2026-10-21 16:27:47 Asia/Shanghai (08:27:47 UTC).
- Bill: demo-bill-1, three simulated charges totaling USD 7.50.
- Order ID: `0LX18082EW768591D`; independent PayPal GET status: `COMPLETED`.
- Capture ID: `3V026169LS895662F`; nested capture status: `COMPLETED`; amount: USD 7.50.
- Configured receiver merchant matches the authenticated order payee: true.
- Durable local status: `SETTLED`; receipt contains the matching order/capture IDs and verification timestamp.
- Repeated protected create and capture calls each returned HTTP 200, SETTLED, and the unchanged receipt. Subsequent independent PayPal GET showed exactly one capture for this order.
- TypeScript checking and all 18 mocked automated tests passed.

Receiver and buyer Activity pages have not been independently inspected. Real network-loss-after-capture and genuine pending/funding-failure scenarios remain manual follow-ups; post-settlement restart and official Sandbox decline injection are verified below; local tests are not presented as live evidence for those cases. Optional AUTHORIZE was not implemented. This completes the core payment verification spike and does not begin the full Agent Runtime.

To explicitly resume a cancelled but subsequently approved order, after obtaining owner confirmation, POST `/api/resume` with the owner Bearer token, then POST `/api/capture`. An unapproved order is rejected and its cancellation latch retained. No new bill or PayPal request ID is generated.

## Phase 0 closure (2026-10-21)

The three required remaining items in the supplied P0 checklist are complete with the evidence below. The optional AUTHORIZE/delayed CAPTURE item is deferred. The actual approved/captured bill is **USD 7.50**, not the USD 7.00 shown in the checklist screenshot. This existing transaction is retained as evidence; no historical amounts were edited and no additional payment was created to match the screenshot.

| Remaining item | Result | Evidence |
| --- | --- | --- |
| Associate one three-charge internal bill with the order | PASS | [Settlement evidence](phase0-settlement-evidence.json): service-search-1 USD 1.25 + service-summary-1 USD 2.50 + service-validation-1 USD 3.75 = USD 7.50. Local bill ID equals PayPal purchase_unit custom_id; local order/capture IDs, merchant and amounts match authenticated PayPal GET. |
| Repeat settlement without duplicate payment | PASS | [Before restart](phase0-negative-evidence.json) and [after restart](phase0-settlement-evidence.json): repeat create/capture/capture/verify returns identical terminal receipts; authenticated PayPal GET shows exactly one identical completed capture before and after. Entire local ledger remains unchanged. |
| Negative testing for payment failure or cancellation | PASS with test boundary | Live PayPal Sandbox official INSTRUMENT_DECLINED injection returns HTTP 422; isolated automated service tests prove a declined capture creates no receipt and retains the same operation key on retry. Cancellation tests prove no capture initiation, persistence across reload, explicit approval required for resume, and immutability after settlement. |
| Optional AUTHORIZE followed by delayed CAPTURE | DEFERRED | Separate feature; neither implemented nor claimed verified. |

### Repeatable verification

With the configured server running:

```sh
pnpm check
pnpm test
pnpm verify:phase0
pnpm verify:phase0 --negative
```

`verify:phase0` requires an existing settled ledger and verifies it through PayPal before sending repeat requests. It refuses to create a new bill. It writes sanitized evidence containing charge IDs, totals, order/capture IDs, statuses and equality checks; credentials, payer details, callback state and request keys are excluded.

`--negative` adds [PayPal's documented request-header negative test](https://developer.paypal.com/negative-testing/request-headers/), using `PayPal-Mock-Response: {"mock_application_codes":"INSTRUMENT_DECLINED"}`. It targets only the independently verified, already-completed order. The result is deliberately injected by PayPal Sandbox, not a genuine funding failure, and does not simulate a second unapproved buyer purchase. The completed receipt stays intact. No negative-test toggle or header was added to the normal server payment flow. Full lifecycle rejection/no-receipt behavior is verified separately using isolated automated fixtures.

Live negative-test evidence was recorded at **16:34:28 Asia/Shanghai**. The existing local server was then gracefully stopped and started again. Post-restart verification at **16:34:58 Asia/Shanghai** returned the same bill and receipt, with one capture `3V026169LS895662F` under order `0LX18082EW768591D`, both COMPLETED. This proves graceful restart persistence, not power-loss durability or a network failure during an in-flight capture.

The earlier cancellation latch was observed live and prevented capture until explicit owner confirmation; a new end-to-end browser cancellation session was not repeated. Genuine funding failure, real capture-time network loss, and visual inspection of buyer/receiver Activity remain distinct unverified operational checks. They are not represented as passed by the negative-test injection. Phase 0 closure does not implement or begin the full Agent Runtime.

Deployment follow-up: the recorded P0 evidence above predates the configurable hosted origin/port/data directory. See [Render deployment preparation](deployment-render.md) for current configuration and separate unverified hosted acceptance. Historical transaction amounts, IDs, statuses and evidence files remain unchanged; no new live payment was made for deployment preparation.

## P2 runtime extension — 2026-10-22

The P0 observations above remain historical fixture evidence. P2 now separately connects three real accepted P1 service purchases to one immutable SQLite batch and a human-approved Sandbox payment. See [P2 evidence](p2-live-evidence.json), [verification](p2-verification.md) and [ADR 0011](decisions/0011-durable-sandbox-settlement.md).

Actual batch `b83897ec-f208-47a1-8e41-e9f38c0566ae`, order `9PU44438P3941414W`, capture `44G16685B65499710`: gross USD 7.50, independently GET-verified COMPLETED. Repeated owner requests and a real server restart retain one receipt, one payment confirmation and three settled allocations. The verification account's outstanding falls from 750 to zero; its 1,500-unit internal allowance is available again. Task lifetime spending remains 750. Original P0 JSON/receipt and the separate original exhausted P1 ledger remain unchanged.

| Capability | Supplier and evidence |
| --- | --- |
| OAuth, buyer approval, order/capture IDs and authoritative payment status | Native PayPal Sandbox, live P2 verified |
| Request-ID replay | PayPal supports bounded retention; Credence persists stable keys/input and adds a five-hour cutoff plus logical retry limits |
| Internal Credit, service verification, aggregate bill and charge allocation | Credence application/SQLite, not a PayPal credit product |
| Once-only local finalization, immutable receipt and balance restoration | Credence transaction, uniqueness and reconciliation; live happy path/restart verified, injected failure/race/crash cases tested locally |
| Cancel latch, explicit resume and delayed/duplicate return hints | Credence state machine; not a PayPal refund or order void |
| Whole unpaid unallocated-charge correction | Credence reversal event; not a provider refund |

No claim of native PayPal agent credit, lending, marketplace payouts, off-session charging or distributed exactly-once processing is added. P2 does not live-test genuine funding decline, packet loss during capture, refund correctness or five consecutive demonstrations. Optional AUTHORIZE and webhook ingestion remain deferred.
