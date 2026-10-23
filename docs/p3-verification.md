# P3 implementation and verification

2026-10-23: owner authorized starting P3. P3.1 is implemented and locally tested. P3.2–P3.4 and the five-consecutive-live-run gate remain pending. P2 was committed/pushed separately as `9c57e46` before these changes.

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
