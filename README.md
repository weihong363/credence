# Credence

**Let agents trade capabilities, not credentials.**

Credence is an AI Agent Economic Runtime prototype: agents purchase capabilities within an owner's bounded internal allowance, verify deliveries, accumulate accepted service charges, and ask the owner to settle one aggregate bill. Deterministic application code controls spending and accounting; agents never receive payment credentials.

The motivation is to give agents useful economic autonomy while making every decision, reservation, delivery, and payment accountable. Internal Credit is an accounting allowance, not lending or PayPal-provided financing. The hackathon target is the PayPal AI Hackathon 2026; Alipay adaptation is a future possibility only.

Repository: [weihong363/credence](https://github.com/weihong363/credence) (private; public release pending). Console screenshot: **[SCREENSHOT — pending]**. Demo video: **[YOUTUBE_URL — pending]**.

## What works today

**P0 PayPal Sandbox** and the **P1 local economic core** are implemented. P1 tests and the real same-task three-service DeepSeek procurement/report gate pass; one architecture correction was verified within five model calls. P2 dynamic settlement is implemented; current live acceptance is in [P2 evidence](docs/p2-live-evidence.json). P3.1 session/CSRF and read APIs are locally tested; the console remains P3.2.

| Capability | Current status |
| --- | --- |
| Server-side OAuth, Orders v2 create/get/capture | Implemented; recorded live Sandbox verification |
| Three simulated service charges, one fixed bill | USD 1.25 + 2.50 + 3.75 = **USD 7.50**, one receiver |
| Buyer approval and completed capture | Recorded order `0LX18082EW768591D`, capture `3V026169LS895662F` |
| Repeated settlement and graceful server restart | Recorded unchanged receipt and exactly one PayPal capture |
| Negative testing | Live Sandbox injected HTTP 422; local tests cover decline, cancellation, timeout and retry |
| Credit account reservation foundation | P1.1 locally tested: SQLite atomic holds, replay, rollback and competing processes; internal interface only |
| Registry, quotes, procurement, execution and delivery checks | P1 local CLI and real DeepSeek minimum gate verified. P0 fixture `verified: true` is not service evidence |
| Append-only ledger, audit and accepted charges | Atomic reserve/release/acceptance and reconciliation locally tested; P2 whole-charge batch and settlement transactions locally tested |
| Agent Economy Console | Planned P3; current server has no application UI |
| AUTHORIZE, payouts, split payments, real lending | Deferred or out of scope |

Evidence is historical, dated 2026-10-21; documentation checks do not imply a new live payment. See the [compatibility report](docs/paypal-sandbox-compatibility.md), [settlement evidence](docs/phase0-settlement-evidence.json), and [negative-test evidence](docs/phase0-negative-evidence.json). A negative-test response is injected by Sandbox, not a genuine buyer funding failure. Power-loss durability, real capture-time network loss, and independent Activity-page inspection are not established.

## Architecture

Today: the default Node HTTP server settles real accepted-charge batches from SQLite through the PayPal Sandbox adapter. The historical P0 server is an explicit isolated regression path. A separate P1 CLI implements registry, coordinator, policy/reservations, providers, delivery checks and a transactional SQLite ledger; a real risk-review task completed. P2 connects real accepted charges to owner-approved aggregate settlement. Only the payment module holds PayPal secrets.

```mermaid
flowchart LR
  Owner[Human owner] --> Console[Planned economy console]
  Console --> Core[Local P1 economic core]
  Core --> Providers[Local provider agents and LLM adapter]
  Core --> DB[SQLite ledger]
  Core --> Payment[PayPal adapter based on verified P0]
  Payment --> Sandbox[PayPal Sandbox]
  Owner --> Sandbox
```

## Stack

Current: Node **20.19+**, TypeScript strict mode, ESM/NodeNext, native `node:http` and `fetch`, pnpm **10.33.4**, `tsx`, and `node:test`. SQLite uses pinned `better-sqlite3` 12.4.1, verified locally on Node 20.19.2; pnpm explicitly permits its native build script. No framework, AI SDK or frontend dependency is installed. The planned frontend uses Vite with vanilla TypeScript for the console; see [technical decisions](docs/spec.md). The owner-created Render service is live on the P2 commit; health/auth boundaries and disk configuration were checked read-only on 2026-10-23. P3.1 is not yet cloud-deployed. See [cloud readiness](docs/render-readiness.md) and the [Render guide](docs/deployment-render.md).

## Setup and historical P0 walkthrough

```sh
pnpm install --frozen-lockfile
cp .env.example .env
```

Fill `.env` locally. Do not overwrite an already configured `.env`, commit secrets, or paste them into an LLM. Generate a separate owner token, for example with `openssl rand -hex 32`, and enter its output locally.

| Current server variable | Required | Meaning |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` | Yes | Sandbox REST app Client ID |
| `PAYPAL_CLIENT_SECRET` | Yes | Server-only Sandbox app secret |
| `PAYPAL_MERCHANT_ID` | Yes | Same app's receiving Sandbox Business merchant ID |
| `OWNER_TOKEN` | Yes | At least 32 random characters; local owner API credential |
| `PUBLIC_URL` | Optional | Local default http://localhost:3000; trusted HTTPS origin for hosted callbacks |

The development command loads `.env` natively. Existing shell variables take precedence. The P1 mission CLI separately consumes `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` and optional `CREDENCE_DB_PATH`; the P0 server does not need them.

```sh
pnpm check
pnpm test
pnpm dev:phase0 # historical fixed-bill regression only
```

The P0 walkthrough above is historical; default `pnpm dev` now uses the P2 batch API below. Local development defaults to `127.0.0.1:3000`; hosted binding reads HOST and PORT. The current package name remains `a2a-paypal-spike`; its scripts are authoritative. `pnpm build` emits backend JavaScript to dist; `pnpm start` runs the SQLite P2 server using environment configuration; `pnpm dev:phase0` explicitly starts the historical fixed-bill server. There is no lint, migration or frontend command yet.

## Sandbox setup and walkthrough

Create a REST app associated with one Sandbox Business account. Locate that account's merchant ID, and use a **different Sandbox Personal account** as buyer. See [PayPal Sandbox setup](https://developer.paypal.com/sandbox-testing/accounts) and the [manual verification guide](docs/paypal-sandbox-compatibility.md).

With `OWNER_TOKEN` exported in the terminal (loading `.env` for the server does not export it into your terminal):

```sh
curl --fail-with-body -X POST http://localhost:3000/api/create -H "Authorization: Bearer $OWNER_TOKEN"
# Open the returned approval URL, log in as Sandbox Personal buyer, and approve.
curl --fail-with-body -X POST http://localhost:3000/api/capture -H "Authorization: Bearer $OWNER_TOKEN"
curl --fail-with-body -X POST http://localhost:3000/api/verify -H "Authorization: Bearer $OWNER_TOKEN"
```

The browser return message is not proof of capture. Backend API verification must establish a matching completed capture. If previously cancelled, explicit owner authorization and `POST /api/resume` are required before capture. Cancellation does not refund an existing capture.

P0 intentionally supports one fixed bill. If it is already settled, these requests return that receipt. **Do not delete or edit an unresolved ledger to force another payment.** On a fresh clone, the above flow creates a new real Sandbox order and requires buyer approval; it is not a mock checkout.

## Tests and recorded evidence

`pnpm test` covers local HTTP/configuration, real SQLite concurrency/recovery and procurement/delivery integration; PayPal and model responses are mocked. `pnpm check` checks source, tests and verification scripts. For an existing completed bill with the server running:

```sh
pnpm verify:phase0
pnpm verify:phase0 --negative
```

The first command checks three-charge/order association, repeats owner API requests and checks PayPal independently. The second adds the official decline-response injection against the already-completed order. They write sanitized evidence JSON files; a fresh clone without a settled local ledger cannot run them successfully. Keep payment evidence separate from local unit-test results.

`.data/settlement.json` is local state, not a public ledger. A process lock prevents two spike servers from sharing it. Following a crash, confirm no server is running before removing only `.data/process.lock`; preserve the settlement. Never copy the state into independent active servers.

## Roadmap and limitations

[P1](docs/roadmap.md): real local service procurement, atomic Credit, accepted deliveries and append-only ledger, without PayPal. P2: multi-charge frozen batches connected to the existing Sandbox transport. P3: observable Agent Economy Console and five consecutive complete demonstrations. P4: public, reproducible submission and English video under three minutes. These phases require explicit implementation approval.

Start with [product requirements](docs/product.md), [authoritative specification](docs/spec.md), [accounting and settlement](docs/settlement.md), [execution roadmap](docs/roadmap.md), [demo storyboard](docs/demo-script.md), [sponsor resource decisions](docs/sponsor-resources.md), and [ADRs](docs/decisions/README.md).

No provider receives a separate payment in this single-merchant experiment. No lending, interest, automatic account debit, production PayPal, marketplace payouts, external A2A network, or Alipay integration is implemented.

## License and submission readiness

**No license file exists yet.** Source publication, an owner-selected open-source license, and repository/video URLs are P4 tasks; this repository must not be represented as submission-ready or licensed open source today. Review the [official competition rules](https://paypalaihackathon.devpost.com/rules) before publication. Do not publish credentials for reproducibility: reviewers configure their own Sandbox app and AI key.

## Render deployment status

[Deployment guide](docs/deployment-render.md) maps every environment variable and manual approval step. `render.yaml` declares one native Node Web Service plus a 1 GB persistent disk; no Dockerfile, Static Site, PostgreSQL or LLM configuration is required for the P2 settlement API. Its SQLite database must remain on the configured persistent disk. Set the three Sandbox PayPal credentials manually; Render generates OWNER_TOKEN and supplies PORT/RENDER_EXTERNAL_URL. The Blueprint sets HOST, DATA_DIR and Sandbox-only PAYPAL_BASE_URL. PUBLIC_URL normally stays unset on Render. `.env.render.example` contains no secrets.

Run `pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:production` before release. Public `/health` exposes only readiness and Sandbox mode; all settlement operations remain owner-protected and same-origin. The application has no frontend bundle or homepage. Review state continuity of the selected economic ledger before any hosted payment; never start an independent backup as another payment authority. Configuration must be reviewed, committed and pushed before Render can read it; no cloud resource/deploy is authorized by preparation alone.

## P1 local economic core

See [verification and live setup](docs/p1-verification.md) for the exact evidence, limitations and recovery commands. Configure the existing local `.env` (keys never go in chat):

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=
LLM_API_KEY=
```

Fill a supported model and key, then run:

```sh
pnpm verify:source
pnpm mission expressjs cors 5317ebe670db2aaebc1d496eb5d33493deefb3ed
pnpm economy status
```

The source check makes only public GitHub requests. The mission makes real model requests, starts a new task and may create accepted internal obligations within the 1,000-unit allowance; it never calls PayPal. Source is pinned and persisted in SQLite; providers never execute repository code. Only verified accepted deliveries become charges, and the final report cites those deliveries. Failure retains accepted charges and releases unfinished holds. Do not delete state to reset spending. Cloud P1 mission execution remains unverified; the existing Render service currently serves the P2 API.

`pnpm economy recover`, `pnpm economy cancel PURCHASE_UUID` and `pnpm economy resume TASK_UUID` support local operation. Resume an interrupted task rather than starting it again; original deadlines, invocation IDs and the eight-call budget are preserved. A completed-task resume returns its saved report. The full-review live gate passes; see [current evidence](docs/p1-full-review-live-evidence.json). At P1 acceptance, the original ledger remained at 1,000 outstanding / zero available; the independent verification ledger had limit 1,500, outstanding 750 and available 750. P1 itself made no payment. P2 has since settled those 750 units; see the current P2 evidence. No frontend or procurement HTTP API is added in P1.

## Full-review completion follow-up

`pnpm mission` now explicitly requests `full-review`: inventory, architecture and independent risk must all be accepted on the same task, and the final report must cite all three deliveries. New missions use one persisted registry-backed plan; restart reuses that plan. Limited programmatic objectives use `scoped`, which is also shown in result/status metadata.

Production-code tests with mocked HTTP now complete in 4 requests normally, 6 with both provider corrections, or 8 with both corrections and both HTTP retries. Synthesis retains one reserved request. The original P1 acceptance passed 66 tests and the production smoke; current P2 validation is in its verification guide. [Full-review implementation and live gate](docs/p1-three-service-follow-up.md) records one real full-review success after explicit 1,500-unit allowance authorization, plus retained historical single-service evidence. The original exhausted allowance is unchanged.

## P2 aggregate Sandbox settlement

Owner-authorized P2 implements immutable batching, durable order/capture keys, cancellation/resume, authoritative GET verification, atomic finalization and crash recovery. Follow [P2 verification](docs/p2-verification.md) for local commands, API contracts, evidence and remaining limits. Default `/api/create` and other fixed-bill routes return HTTP 410; use the batch API. The historical P0 JSON ledger/evidence is not converted into real charges.

```sh
CREDENCE_DB_PATH=.data/p1-full-review-verification.sqlite PORT=3001 PUBLIC_URL=http://localhost:3001 pnpm dev
# A local owner can use pnpm settlement status|order|capture|cancel|resume|reconcile|recover|reverse.
# Each network mutation needs its batch ID and owner request key; see the guide before use.
```

The existing `.env` is server-only. `CREDENCE_DB_PATH` optionally selects the economic SQLite database; by default the server uses DATA_DIR/credence.sqlite. Never run a backup as a second active payment database. No frontend, Render deployment or new model call is needed for this P2 gate. P3.1 session/read foundation is locally tested; P3.2–P4 remain pending.

## P3.1 session and read API foundation

P2 was pushed as `9c57e46`. Browser authentication now exchanges an owner-supplied token via same-origin `POST /api/session` for a one-hour HttpOnly session; cookie mutations need exact Origin plus X-CSRF-Token. Logout, expiry, re-login rotation and restart revoke old cookies. CLI Bearer access remains available. There is no login page or console yet.

New owner read APIs expose task summaries, committed audit events and account ledger using bounded afterSeq pagination. Raw model/provider inputs/outputs, free-form audit reasons, callback secrets and payment request keys are omitted. See [P3 verification and contracts](docs/p3-verification.md). P3.1 passes 105 local tests plus the compiled session/restart smoke; P3.2 starts the mission/activity and evidence UI. The five consecutive real-run gate remains pending. No new PayPal/model request, database migration, dependency or cloud deployment was needed for this slice.
