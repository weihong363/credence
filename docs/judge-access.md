# Judge access

Updated 2026-10-25. Isolated judge implementation is deployed. First anonymous real task completed all three services in five model calls; its payment still awaits human approval/Capture verification. See [live evidence](p4-judge-live-evidence.json).

## Primary: hosted Render demo

Owner console: https://credence-sandbox.onrender.com/ . Judge entry after deployment and enablement: https://credence-sandbox.onrender.com/judge/ . The judge button creates a guest session without registration or an owner token. Never distribute OWNER_TOKEN. PayPal buyer login and human approval are still required.

Each guest has a separate persistent SQLite database under DATA_DIR/judge, separate owner/account, tasks and payments. The existing owner ledger is never used by the guest dispatcher. Cookie is HttpOnly, SameSite=Strict, Secure on HTTPS, scoped to /judge; mutations require same-origin and CSRF. Authorization headers are rejected at the guest boundary. Public source is fixed to expressjs/cors at 5317ebe670db2aaebc1d496eb5d33493deefb3ed. Source processing/spend consent remains explicit in the form.

Operator enablement: JUDGE_MAX_MODEL_CALLS=80 with valid server-side LLM and Sandbox configuration. Owner authorized this limit on 2026-10-25. Admission reserves eight possible calls per session: at most ten lifetime sessions, one mission per session, and the existing durable eight-call task cap. Failed/unused slots are conservatively not refunded. This bounds total model requests to 80 without claiming it bounds token cost in dollars. The persisted admission policy rejects a changed cap at startup. Restart/logout/expiry do not replenish slots. Never delete the registry or guest databases to refill quota.

Admission throttles globally to one new session per ten seconds, with 240 authenticated requests/minute per session. One guest task execution window is admitted at a time (390 seconds); task execution remains bounded to its original five-minute deadline. Admission and model ceilings survive restart; short request-rate windows are process-local. Existing owner task usage is outside the guest envelope and remains separately owner-controlled. Public anonymous slots can be exhausted by abuse: do not promise availability of new executions after capacity is used.

Guest sessions expire after 24 hours. Keep the same browser session to inspect results and settle; logout revokes access, not financial history. Backend recovery retains unresolved obligations after expiry/restart. Guests cannot access another guest or owner data, including known task/account/batch IDs. Unknown payment status stays locked; no replaced bills or fake success. Existing payment services enforce merchant/amount/batch matching and business replay. All payments remain Sandbox; no real-money capture or provider payouts.

## Secondary: local reproduction

See [reviewer guide](reviewer-guide.md) and [Sandbox testing](paypal-sandbox-testing.md). The public source path uses reviewers' own backend credentials. The labeled simulated console is credential-free but does not establish real AI/payment behavior.

Docker Compose commands (Docker Engine and Compose v2 required):

```sh
# Copy .env.example to .env only if absent; fill your own backend credentials.
docker compose up --build -d
docker compose ps
# Wait for healthy; the server creates the DB before explicit initialization.
docker compose exec credence node dist/admin/initialize.js 1500
```

Open http://localhost:3000 with your local owner token. Compose binds only loopback and persists SQLite in a named volume. `docker compose down` retains that volume; never use `down -v` to retry uncertain payment. Initialization fails instead of overwriting an existing conflicting allowance. Local judge mode is optional via JUDGE_MAX_MODEL_CALLS; it consumes the same finite admission envelope in its own persistent directory.

## Availability through judging

Current Render topology is an existing paid 0.5 CPU/512 MB Web Service with a 1 GB disk. There is no Free Web Service or PostgreSQL, so free-service cold starts/30-day PostgreSQL expiry do not apply. No new paid resources are needed. Keep the service, disk, funding, operator recovery access and LLM account available through the official judging end on December 15, 2026. Paid hosting and finite quota do not guarantee future uptime; balance/funding coverage still needs verification. Deployment with a disk causes a brief interruption.

Keep backend credentials server-only and buyer credentials in a separately authorized private channel. No buyer password is bundled in source. Use a reviewer-owned Sandbox Personal buyer or privately arranged dedicated account; anonymous Credence access does not bypass PayPal authentication.
