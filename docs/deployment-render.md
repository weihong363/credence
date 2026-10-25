> Current status (2026-10-23): source 4dad92b is live (2026-10-24). First real hosted API procurement and USD 7.50 settlement passed independent COMPLETED verification, settled replay and same-commit redeploy persistence. Browser-only five-run acceptance passed 5/5; the account-option UI fix is deployed; authenticated visual re-login confirmation remains pending. See [latest evidence](p3-live-evidence.json). Historical preparation follows.

> P2 update (2026-10-22): default start now serves the SQLite batch API; the fixed-bill routes are archived. The configured DATA_DIR persistent disk stores credence.sqlite by default; optional CREDENCE_DB_PATH must also stay on persistent storage. P0 deployment walkthrough below is historical; follow docs/p2-verification.md for current endpoints. No Render resources were created or deployed during P2.

# Render deployment preparation

Historical preparation status (2026-10-21): **configuration prepared; not deployed at that time**. No Render account, workspace, GitHub connection, service, disk or credit balance was inspected or changed. No cloud resource was created and no deploy was triggered. Approval is required before applying the Blueprint. Current code is the **P0 Sandbox API**, not the planned full Agent Runtime or console.

This preparation uses the official [Render deployment](https://render.com/docs/web-services), [Blueprint](https://render.com/docs/blueprint-spec), [environment](https://render.com/docs/configure-environment-variables), [platform variable](https://render.com/docs/environment-variables), [compute plan](https://render.com/docs/compute-plans), and [persistent disk](https://render.com/docs/disks) conventions, reviewed 2026-10-21. Markdown endpoints were unsupported by the web reader, so the HTML references were read instead.

## Actual components and resource plan

| Component | Actual repository | Render resource |
| --- | --- | --- |
| Backend | Node 20.19+, TypeScript/ESM, native node:http and fetch | **One Web Service**, native Node runtime; name `credence-sandbox` |
| Frontend | No frontend source/build exists; callback pages are plain text | **None**; no Static Site or frontend API base URL |
| Persistence | One fixed settlement JSON snapshot and process lock; no SQLite/PostgreSQL code yet | **One 1 GB persistent disk**, mounted at `/var/data/credence` |
| Database | No SQL driver, migrations or database URL consumed | **No managed PostgreSQL**; do not provision an unused database |
| AI | No runtime model client or provider credentials consumed | **No LLM configuration** in this deployment |
| Build | TypeScript compiled with `tsconfig.build.json` | Frozen pnpm install, `pnpm build`; start `node dist/server.js` |

The Java-backend instruction does not apply: there is no Java project or JVM build. `HOST`/`PORT` implement the requested binding for the real Node server. No Dockerfile is required because Render supports Node natively. `.dockerignore` is defensive packaging hygiene, not a claim that a Docker image was built. Package and lockfile dependency versions remain unchanged; TypeScript/tsx are build/test dependencies, not production runtime loaders.

The Blueprint selects paid compute `0.5c-512mb` (0.5 CPU / 512 MB), one instance, one disk; automatic deploys and preview generation are disabled. It omits region, so Render's documented default applies; review region and existing resources before approval. No workers, workflow SDK, cache, Static Site or database is declared. A disk-backed single-process service matches the existing JSON store; it cannot support multiple independently writable copies of the same bill.

## Environment variables mapped to code

`src/config.ts` validates configuration before listening. `src/server.ts` uses the selected host, port and durable path. The PayPal adapter accepts **only** the Sandbox base URL. There is no frontend bundle or secret-bearing configuration endpoint.

| Variable | Source / manual action | Application behavior |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID` | **Manually enter** Sandbox REST app ID in initial Blueprint prompt | Server-side OAuth client ID |
| `PAYPAL_CLIENT_SECRET` | **Manually enter**, server secret only | Server-side OAuth secret; never copied to browser or chat |
| `PAYPAL_MERCHANT_ID` | **Manually enter** same app's receiving Business merchant ID | One receiver; matching payee checked during verification |
| `OWNER_TOKEN` | Blueprint `generateValue: true`; retrieve privately in Dashboard for owner API requests | Owner Bearer authentication; at least 32 random characters; no anonymous payment actions |
| `PAYPAL_BASE_URL` | Blueprint sets `https://api-m.sandbox.paypal.com` | Used for OAuth and Orders calls; live or arbitrary URLs fail validation |
| `HOST` | Blueprint sets `0.0.0.0`; local default `127.0.0.1` | Network bind address |
| `PORT` | Render supplies; local default `3000` | Integer 1–65535; do not hardcode port 3000 on Render |
| `DATA_DIR` | Blueprint sets `/var/data/credence`; local default `.data` | Stores `settlement.json`, atomic temp file and `process.lock` together |
| `RENDER_EXTERNAL_URL` | Render supplies | Trusted public HTTPS origin when PUBLIC_URL is absent |
| `PUBLIC_URL` | Normally **leave unset** on Render; set manually only for an actual custom HTTPS origin | Overrides RENDER_EXTERNAL_URL; must be origin only, no credentials/path/query/hash; HTTP allowed only for local loopback |
| `RENDER` | Render supplies `true` | Default external binding and requirement for a public origin |
| `NODE_ENV` | Blueprint sets `production` | Standard runtime environment; not a switch to live PayPal |

`.node-version` pins the existing local Node version 20.19.2; package engines retain the Node 20 major. Do not let Render's newer default silently change the runtime. If an existing Dashboard `NODE_VERSION` overrides the file, align it deliberately. [Node version precedence](https://render.com/docs/node-version).

No `DATABASE_URL`, `LLM_*`, `VITE_*`, frontend API URL or CORS allowlist is invented for components that do not exist. HOST, PORT, DATA_DIR and PAYPAL_BASE_URL are newly implemented configuration keys, not previously supported ones. `.env.render.example` documents them with empty secrets; production start reads platform environment directly, never `.env`. Do not bulk-copy local `.env`, which can contain localhost PUBLIC_URL and local owner credentials.

Render `sync: false` values are prompted on initial creation; later edits belong in that service's Environment page. Saving values can deploy unless “Save only” is selected. Existing omitted values can persist across Blueprint syncs; inspect them before applying. Generated OWNER_TOKEN is not deliberately rotated by each sync. Never export secret environment values into shared collections or README examples.

## GitHub connection and Blueprint approval

1. **Commit and push the prepared files only after review.** This task leaves local changes uncommitted and does not push or deploy. Render reads `render.yaml` from the remote branch, not this working directory. Include build/config/server/tests/docs changes together; YAML alone is insufficient.
2. In Render Dashboard, select the intended workspace and inspect existing services and Blueprints. Look for the same GitHub repo, `credence-sandbox`, and existing state. **Do not create a second service/Blueprint if one already manages this application.** Update/import the intended existing service only after reviewing its current configuration; matching a name is not evidence of ownership. If unsure, stop before Apply.
3. Connect GitHub through Dashboard's Git provider authorization flow. Grant the Render GitHub App access to the private repository `weihong363/credence` only as needed. Account configuration does not prove repository authorization. No Render credentials need to be pasted into this chat.
4. For a confirmed new deployment, choose **New → Blueprint**, select that repository, branch `main`, root `render.yaml`. Alternatively, after pushing, open [this Blueprint setup link](https://dashboard.render.com/blueprint/new?repo=https%3A%2F%2Fgithub.com%2Fweihong363%2Fcredence). The link is a setup entry point, not deployment evidence; it will not find an unpushed YAML file.
5. Enter the three PayPal values privately, review generated OWNER_TOKEN, one paid service, one disk, region, total estimate, sponsor credits and billing. Ensure PUBLIC_URL is not inherited as localhost. Verify no PostgreSQL or Static Site is being proposed.
6. **Stop at the review screen until deployment approval.** Clicking Apply creates/updates resources and begins the initial deployment even with autoDeployTrigger off. No such action was taken here. Do not enable Blueprint automatic sync/previews inadvertently. Subsequent deployments remain manual.
7. Once approved, apply and monitor build/start/health results. Build runs `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build`; dev dependencies are intentionally installed for the compiler. Start runs plain Node without tsx or `.env` loading. Nothing in the build reads or writes the runtime disk.

Render CLI is not installed in this environment; no CLI or account authentication was assumed. YAML was validated locally against the current [official JSON Schema](https://render.com/schema/render.yaml.json) using temporary validation tooling outside the project. This is structural validation, not a platform/account dry run. If CLI is available later, run `render blueprints validate render.yaml` before Apply; it does not deploy. Dashboard review must confirm plan/account compatibility and existing-resource association.

## State continuity and safe restart

This service remains P0's **single fixed bill**, USD 7.50, with business identity `demo-bill-1`. Hosted data is not automatically imported from local `.data`, and a public API deployment does not create a real Agent Runtime. Preserve the recorded local payment and its evidence files.

Choose the state plan **before any hosted create/capture**:

- For presenting the already-verified completed bill with the same merchant, stop writes on the source, securely transfer only its completed `settlement.json` to the mounted DATA_DIR using an authorized administrative path, verify its content/ownership privately, and start the service. Do not copy a `process.lock` or expose the file publicly. Original completed receipt remains unchanged. This transfer is manual and was not performed here.
- For an empty hosted disk, `/api/settlement` initially returns null. It is not evidence of a payment. The first create uses the same fixed invoice ID; the existing merchant may already have used it and PayPal may reject a duplicate invoice. **Do not clear local/remote ledgers, rotate IDs, or create a replacement order to force another payment.** Dynamic independent bills remain P2 work. This deployment is not a five-run full product demo.
- Do not move an unresolved order between different callback origins. Finish/reconcile on its original endpoint before migration; changing PUBLIC_URL does not rewrite an already-created PayPal order or its approval return URL.

All durable files and the lock use DATA_DIR. A normal SIGTERM stops accepting connections, lets in-flight responses finish, then exits/releases the lock; a 25-second app cutoff stays within Render's default 30-second shutdown window; disk-backed services do not support maxShutdownDelaySeconds. A hard kill can leave a stale lock. Confirm the old process is stopped before removing only that lock via an authorized service shell; never remove settlement.json. The next server must GET the existing PayPal order before retrying uncertain capture, as in P0. Do not auto-break locks on boot.

Disk deploys can briefly interrupt service and have no zero-downtime guarantee. Back up the JSON consistently while writes are stopped, retaining associated merchant/app configuration privately. Restoring old state can invalidate local knowledge of remote payments: reconcile existing IDs before any mutation. Disk presence is not proof of backup or financial exactly-once behavior after manual data loss.

## Public verification after approved deployment

Replace `<origin>` with the actual service URL; never put credentials in URL parameters. `/` is not a homepage and is expected to require owner authentication; there is no frontend to test. Use `/health` for a public readiness check:

```sh
curl --fail-with-body https://<origin>/health
```

Expect `{"status":"ok","paymentEnvironment":"sandbox"}`. It exposes no credentials or ledger and makes no PayPal calls. It is process readiness after startup/config/lock acquisition, not a PayPal availability guarantee or disk-failure diagnostic. Probe Host may differ internally; all financial/callback routes still validate the configured public Host.

1. GET `/api/settlement` without Authorization must return 401. With the owner token supplied locally in an Authorization header, it returns existing state or null. Never paste this full protected response into public logs because it includes private operation/callback identifiers.
2. Requests with a mismatched Host or foreign Origin must return 403. No Access-Control-Allow-Origin is emitted. There is no separate frontend origin; cross-origin browser integrations are intentionally unsupported. Any future frontend should use the same backend origin or require a separately reviewed CORS design.
3. If a fresh payment is authorized and no prior fixed invoice conflict exists, POST `/api/create`, follow its actual approval URL as the Personal buyer, then return to the configured HTTPS origin. A valid return says approval returned; it does not capture. Check matching state/order binding, never forge the return URL.
4. Owner POSTs `/api/capture`; server GETs approval, captures using its persisted key, then GETs authoritative payment status. Expect SETTLED only for exact matching completed order/capture, merchant, currency and USD 7.50. Cancellation latches; POST `/api/resume` only after explicit owner confirmation, then separate capture.
5. Repeat create/capture: same bill/receipt, no additional payment. Restart/redeploy with the same disk and verify receipt/IDs persist. Independently GET the stored order through a trusted server/admin path to confirm one capture; do not equate cached `/api/verify` after settlement with a new remote GET.
6. Retain sanitized hosted evidence and timestamps separately from P0's historical JSON files. Genuine hosted OAuth, approval, capture and deployed TLS/proxy behavior remain **unverified until this manual run**. Existing `pnpm verify:phase0` is a local-state/localhost tool; do not point it at cloud state by guessing environment variables.

## Local checks and troubleshooting

```sh
pnpm install --frozen-lockfile --prod=false
pnpm check
pnpm build
pnpm test
pnpm test:production
```

The smoke script starts compiled `dist/server.js` on a temporary local port with fake credentials and a temporary DATA_DIR, tests health/authenticated local cancellation persistence through graceful restart, and makes **no PayPal calls**. It needs permission to open loopback ports in restricted sandboxes. HTTP tests inject a mock gateway; they do not prove a new hosted payment.

| Symptom | Check / action |
| --- | --- |
| `pnpm` missing / Corepack error | Keep `corepack enable` and pinned packageManager. Verify network access/build runtime. Do not switch lockfiles. |
| `tsc` missing | Build install must include `--prod=false`, even with NODE_ENV=production. Start alone does not compile. |
| Frozen lockfile fails | Commit matching package/lockfile; do not bypass frozen install or expose registry tokens in logs. |
| `dist/server.js` missing | Run `pnpm build` in repo root using tsconfig.build.json; do not start src with plain Node or rely on a Dockerfile. |
| Wrong Node version | Check Dashboard NODE_VERSION override versus .node-version/package engines. |
| Port detection/health failure | HOST=0.0.0.0, PORT provided by Render, healthCheckPath=/health; missing required configuration can prevent binding. |
| Startup `EEXIST` lock | Confirm previous process stopped; preserve settlement file, recover only stale lock. Never run two instances against one bill. |
| Data disappears after redeploy | Confirm DATA_DIR equals the runtime disk mount; do not store financial state on the ephemeral repo filesystem. |
| HTTPS callback/API 403 | PUBLIC_URL override or RENDER_EXTERNAL_URL must equal the accessed origin exactly. Use configured hostname, no localhost, extra path or untrusted forwarded-host override. |
| 401 owner API | Use the generated cloud OWNER_TOKEN, not the local token. Keep it in Authorization, not frontend code. |
| PayPal HTTP 400/401/422 | Check Sandbox app/merchant pairing, credential presence, fixed invoice conflicts and safe issue codes. Do not log raw remote bodies or rotate an ambiguous payment key. |
| Return page but no receipt | Approval is not capture. Owner triggers capture; pending/unknown must reconcile rather than report success. |
| Duplicate service proposed | Cancel Apply; inspect existing Blueprint/repo/resource mapping before provisioning again. |

## Cost and go-live checklist

One paid `0.5c-512mb` Web Service plus 1 GB disk is the initial P0 capacity choice, not a measured full-runtime requirement. No DB, second service, Docker registry or LLM bill is introduced. [Render pricing](https://render.com/pricing) and the [vendor cost guide](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses) indicate a starting budget around **$7 compute + $0.25 disk per month**, excluding workspace charges, bandwidth/build overages and taxes; verify the actual Dashboard quote. The advertised $50 hackathon credit is **not a verified or redeemed account balance**. Confirm applicability, expiration, overages and coverage through judging before approval. See [sponsor decisions](sponsor-resources.md).

- [ ] Review, commit and push configuration/source/tests/docs together; verify remote render.yaml exists.
- [ ] Inspect intended workspace/GitHub permissions and existing services; no duplicates.
- [ ] Approve paid plan/disk/region and credit/billing terms.
- [ ] Enter PayPal Sandbox credentials; privately retain generated OWNER_TOKEN; verify origin and data settings.
- [ ] Decide safe continuity of the existing completed fixed bill before allowing financial mutations.
- [ ] Approve Apply/deployment, then verify public health, authorization, HTTPS callback, persistence and authoritative payment status.
- [ ] Record actual hosted evidence. No full-runtime, frontend, PostgreSQL or AI capability is claimed by this deployment.

## Preparation verification record

Local frozen-lockfile installation, TypeScript checks, backend build, 25 local tests, compiled-process smoke/restart checks and official JSON Schema validation passed during preparation. The default sandbox disallows loopback listeners, so HTTP/smoke tests were rerun with local-network permission; they still used fake credentials and mocked PayPal only. The CLI/platform validation and all real Render-hosted checks are not claimed complete. No dependency versions or lockfile changes were needed.

Blueprint validation correction: Render Dashboard rejected maxShutdownDelaySeconds for a disk-backed service despite structural JSON Schema acceptance. The unsupported field was removed and the app drain cutoff reduced to 25 seconds. Dashboard/platform validation remains necessary; schema validation alone cannot check every cross-field restriction. Interrupted payment attempts retain their persisted IDs and must reconcile before retry.

## Explicit P3 cloud initialization (prepared locally; not cloud verified)

The server never auto-seeds an account. After the commit containing `src/admin/initialize.ts` and `src/admin/verify-session.ts` is deployed, open the **existing** credence-sandbox service → **Shell**. Run in its application directory:

```sh
/opt/render/project/nodes/node-20.19.2/bin/node dist/admin/initialize.js 1500
/opt/render/project/nodes/node-20.19.2/bin/node dist/admin/verify-session.js
```

1500 is the owner's previously authorized internal Credit allowance (USD minor units), with a 400-unit purchase cap. It is not a payment or PayPal credit. The initializer resolves the same CREDENCE_DB_PATH or DATA_DIR/credence.sqlite as the server, requires an existing database, and atomically creates the demo owner, coordinator, providers and catalog. It creates no task, charge, order or payment. Exact replay returns the same identity without resetting balances or allowance; a different allowance, multiple accounts or partial preexisting database fails closed. Do not delete state to bypass a conflict.

The session verifier reads OWNER_TOKEN from the server environment internally. It never prints credentials, cookies, CSRF tokens or response bodies. It verifies login, authenticated session/economy reads, CSRF rejection, logout and cookie revocation. Successful output is `SESSION_LOGIN_READ_CSRF_LOGOUT_PASS`. It performs no economic mutation or remote PayPal/model request. PUBLIC_URL or Render's RENDER_EXTERNAL_URL must identify the HTTPS service origin.

No new HTTP bootstrap endpoint, environment variable, dependency, migration or startup side effect was added. The Render connector currently has no remote command execution capability; local SSH strict host verification failed because this host is not in known_hosts. No host check was bypassed and no cloud initialization/session success is claimed. Run the commands only after deploying their source revision. Actual database persistence across a subsequent restart remains a separate acceptance check.

## Dedicated operator SSH access

Prepared locally on 2026-10-23 using the official [Render SSH guide](https://render.com/docs/ssh). The existing paid Oregon service supports direct SSH. This is separate from Render MCP or GitHub authorization.

- Private key: `~/.ssh/credence_render_ed25519` (mode 0600, local only; never upload).
- Public key: `~/.ssh/credence_render_ed25519.pub`; add its full single line under Render **Account Settings → SSH Public Keys → Add SSH Public Key**, named `credence-render-codex`.
- Isolated config: `~/.ssh/credence_render_config`; existing global SSH config and keys are untouched.
- Isolated host trust: `~/.ssh/credence_render_known_hosts`. Scanned Ed25519 host key was compared with the official Oregon fingerprint `SHA256:KkZPgnApmttFYSkdJsCi7B01sgZPMI6kY53MDbbanGM` before saving. Strict checking remains enabled.

```sh
pbcopy < ~/.ssh/credence_render_ed25519.pub
ssh -F ~/.ssh/credence_render_config credence-render
# Read-only connection check:
ssh -F ~/.ssh/credence_render_config credence-render 'pwd'
```

The dedicated key has no passphrase to allow authorized noninteractive Codex operations; file permissions restrict the private key. The config disables agent forwarding and agent identities. Account SSH authorization can reach other services permitted to that account; the local alias targets only the existing Credence service and does not make the uploaded key service-scoped. Delete the public key from Render and the dedicated local key when access is no longer needed. No API key, PayPal credential or application environment change is needed. Connect to the running service rather than an ephemeral shell for operations requiring its persistent disk. SSH setup alone does not authorize deployment, initialization or financial mutations.

SSH connectivity was verified after owner public-key authorization. The SSH shell defaults to Node 24.22.1, while the running application uses `/opt/render/project/nodes/node-20.19.2/bin/node`; use that Node 20 executable for admin commands to match the native SQLite binding.

## P3.4 model configuration and task recovery

The controlled mission surface uses existing server variables LLM_BASE_URL, LLM_MODEL and LLM_API_KEY; enter them in Render Environment and save/deploy. For DeepSeek use its configured HTTPS API origin and a model actually enabled on the account. Do not expose these as frontend build variables. No new service or worker is needed. Missing/invalid model settings disable task start while preserving session/inspection/settlement APIs.

Schema v8 adds mission request/lease tables. Before upgrading, preserve a consistent backup on the existing disk and never run that backup as another active economic authority. A forced interruption leaves the original OPEN task; wait for its 90-second mission lease to expire, then explicitly resume from the console. Original five-minute deadline and eight-call accounting remain unchanged. A terminal task returns its saved state and cannot restart execution. Start-request metadata is journaled in browser sessionStorage without credentials; reloading only looks up the original request and does not automatically invoke a model. An API credential/endpoint smoke is not a five-run UI acceptance record.

## Judge availability preparation — 2026-10-25

The existing paid service and persistent disk remain the deployment target; no new resources or free PostgreSQL are introduced. Keep funding, server-only Sandbox/LLM secrets, disk persistence and operational access through judging ending December 15, 2026. Future uptime and remaining credits have not been verified. Anonymous guest isolation, durable usage quotas and authorized buyer-access procedure must pass before enabling a public workflow. Current deployed owner authentication remains intact. See [judge access readiness](judge-access.md).

### Isolated judge mode

Owner authorized JUDGE_MAX_MODEL_CALLS=80 on 2026-10-25. This optional server-only setting enables /judge/ and stores its immutable admission policy plus guest ledgers under DATA_DIR/judge on the same persistent disk. Ten lifetime sessions reserve eight calls each; logout, restart and expiry do not refund slots. Leave unset to disable new guest HTTP access; never remove the registry to refill it. Do not set production PayPal URLs or distribute OWNER_TOKEN. No additional paid services are required. See ADR 0017 and judge-access.md.
