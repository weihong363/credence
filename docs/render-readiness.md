# Render readiness and deployment evidence

Checked 2026-10-23, approximately 10:22 Asia/Shanghai. Owner authorized a read-only cloud check followed by committing/pushing P3.1. No Render service, disk, environment variable, deploy or payment was created/changed by this check.

## Verified cloud baseline

| Item | Observation |
| --- | --- |
| Workspace | My Workspace; existing owner-selected workspace |
| Service | credence-sandbox, srv-dbdc704s728c73be7ie0 |
| URL | https://credence-sandbox.onrender.com |
| Repository / branch | weihong363/credence, main |
| Live deploy | dep-dbdc70ks728c73be7jh0, status live, source commit 9c57e467394f4053302074deae08055c77ed25ae (P2) |
| Compute | One 0.5c-512mb instance, Oregon; not suspended |
| Port / health configuration | Open TCP port 10000; healthCheckPath /health |
| Persistent disk configuration | 1 GB, mounted at /var/data/credence |
| Automatic deploy / previews | Off; this source push does not trigger a service deployment |
| Public GET /health | HTTP 200, status ok, paymentEnvironment sandbox |
| Unauthenticated GET /api/economy | HTTP 401, OWNER_AUTH_REQUIRED |
| Unauthenticated GET / | HTTP 401, expected for the current API-only service |
| Error-log query | No entries in the connector's returned error-log window; this is not a guarantee of error-free operation |
| Memory sample | 24,514,560 bytes (about 23.4 MiB) against a 512 MiB limit; one idle sample only |
| CPU usage | No samples returned; no capacity conclusion drawn |

The platform service/deploy data and direct public HTTP checks establish that P2 is serving requests. They do not establish that P3.1 is deployed. No authenticated owner request, Sandbox OAuth/payment request, new model request or state mutation was used for this check.

## Not yet verified

- Secret values and their correct PayPal merchant/app pairing were not retrieved. A successful boot indicates that the startup-required configuration passed application validation; it does not prove credentials can authenticate with PayPal.
- LLM credential presence/correctness was not inspected. Real mission execution is not part of the public health check.
- Cloud Owner/Agent/account/catalog initialization and the contents of the cloud ledger were not read. The current server does not auto-seed them.
- Disk attachment and mount are confirmed in platform configuration. Actual database placement, backup procedure and persistence across a cloud restart/redeploy remain unverified.
- Cloud P3 session/CSRF, browser UI and the five consecutive real-run gate remain unverified. P3.1 is locally tested and included in the next source commit only.

## Next ordered steps

1. Owner approval to deploy the reviewed P3.1 source commit to the existing service; do not create another Blueprint/service. Keep manual deploys enabled.
2. Introduce explicit one-time cloud initialization with an owner-approved allowance and no automatic purchases/payments. Do not copy the local active or historical payment database into another payment authority.
3. Configure LLM secrets only on the server before real mission execution; never return values through the console/API/logs.
4. Build P3.2 task/activity/evidence UI using the existing same-origin session and read API foundation, then P3.3 owner financial controls and P3.4 result/error recovery.
5. After initialization and UI acceptance, verify persistent state through an approved cloud restart and run the real multi-service/Sandbox gate with human approval for every payment.

P3.1 local validation before push: pnpm check; pnpm test (105/105); pnpm test:production (including build and compiled session/CSRF/restart checks); git diff --check. Historical P0/P1/P2 payment evidence remains unchanged.

## P3.1 manual deployment verification

On 2026-10-23 the owner authorized the next deployment step. The existing service in My Workspace was reused; no service, disk or secret configuration was created or changed. Remote main was confirmed at `9fec52cbc46f30f53ce8b98bf1e5d320dcd61a50` before triggering one deployment with the build cache retained.

- Deploy: `dep-dbdcccbncjis739n0o50`; source commit `9fec52cbc46f30f53ce8b98bf1e5d320dcd61a50`.
- Render status: **live**; finished 2026-10-23T02:28:44.931112Z (10:28:44 Asia/Shanghai).
- Public `GET /health`: 200, `status: ok`, `paymentEnvironment: sandbox`.
- Unauthenticated `GET /api/economy` and `GET /api/session`: 401, `OWNER_AUTH_REQUIRED`.
- `POST /api/session` with missing Origin or foreign Origin: 403, `ORIGIN_FORBIDDEN`; no credentials were supplied.
- Every checked response included `Cache-Control: no-store`.
- Error-log query from deployment start through 02:29:19Z returned no entries; this is limited to that query window.

This supersedes the baseline's statement that P3.1 was not deployed and completes ordered step 1 above. It verifies deployment and public security boundaries, not authenticated login, cloud account initialization, database continuity, real model execution or Sandbox settlement. No account, model task or payment was initiated. The disk-backed service has no zero-downtime guarantee; actual state persistence still requires a separately approved acceptance check. Automatic deployment remains configured off.

## Initialization preparation follow-up

Explicit operator initialization and credential-safe session verification commands are now prepared locally; see the final section of [the Render guide](deployment-render.md). Local 108-test suite, type check and production smoke pass. They have not been committed/deployed or run against the hosted database. The connector exposes no remote shell, and strict SSH host checking found no trusted host record; no SSH trust setting was changed. Therefore cloud initialization, authenticated login and actual ledger continuity remain unverified. P3.2 implementation has not started in this slice.

## Cloud initialization execution — 2026-10-23

Owner authorized committing/pushing, deploying and executing the prepared initialization/session checks. Commit `fc229382b062348ab577b754d9a72308a94e5451` was pushed to main. Existing service deployment `dep-dbdcmvcs728c73bfqr5g` reached **live** at 2026-10-23T02:51:29.129422Z. SSH confirmed that source revision and Node 20.19.2 was used explicitly.

Before initialization, the resolved database was confirmed under `/var/data/credence/`, with zero accounts, charges and batches. `initialize.js 1500` succeeded twice with the same identity: owner `adf725b1-367e-4340-9a7a-8cdbdbcf341c`, account `ba84e935-fafd-4369-8390-b2f63723ee65`. This proves initialization replay in the running cloud instance; it does not prove persistence across a later restart. No procurement/model/payment operation was invoked.

**Session acceptance failed:** the verifier exited 1; a separate sanitized HTTP check returned public health 200 and login 401 `OWNER_AUTH_REQUIRED` when using the SSH environment's OWNER_TOKEN. Correct configuration parity between SSH and the running server has not been established. No token was printed, changed or rotated. Automatic approval review rejected reading the running process environment for a boolean-only credential comparison because that would probe secrets from a nonstandard source. That diagnostic was not executed or bypassed. A subsequent read-only database count check was interrupted by the remote SSH host and yielded no new evidence. Full login/CSRF/logout acceptance remains blocked pending an approved diagnostic or owner-side configuration review.

### Session recheck after owner requested renewed acceptance

Public `/health` again returned 200; login using the normal SSH environment again returned 401 `OWNER_AUTH_REQUIRED`. The token variable is present and has no outer whitespace; no value was output. A direct loopback attempt returned 403 `ORIGIN_FORBIDDEN`, so it does not establish credential parity. Render's deployment history still shows `dep-dbdcmvcs728c73bfqr5g` as the latest live deployment, with no later deployment recorded. A saved environment change taking effect in the running application has therefore not been verified. Session/CSRF/logout acceptance remains incomplete; no process environment was inspected and no credential was changed.

## Session and post-redeploy persistence acceptance — passed

After the owner updated the credential and confirmed deployment, Render reported manual deploy `dep-dbdcrp4s728c73bgabgg` **live**, source `fc229382b062348ab577b754d9a72308a94e5451`, finished 2026-10-23T03:02:23.420478Z. Using only the normal SSH environment credential and Node 20.19.2, the public HTTPS checks passed:

| Check | HTTP result |
| --- | --- |
| Health | 200 |
| Owner login | 200 |
| Cookie-authenticated session, economy and task reads | 200 each |
| Logout without CSRF token | 403 |
| Logout with CSRF token | 200 |
| Reuse of revoked cookie | 401 |

The test session was revoked; no credentials/cookies/CSRF values were emitted. A subsequent authenticated read confirmed the same initialized account `ba84e935-fafd-4369-8390-b2f63723ee65`, OPEN, limit/available 1500, reserved/outstanding 0 and zero charges. This verifies account continuity through this redeploy, not power-loss durability or financial recovery under load. The earlier failed login evidence is retained; its exact configuration mismatch was not independently established. No process environment probing, model request or payment occurred. This supersedes the earlier pending/failed login and account-persistence status for this limited acceptance scope. Browser UI, real mission execution and full payment/restart acceptance remain pending.

## P3.2/P3.3 deployed — 2026-10-23

Owner requested committing and deploying the existing console before the next slice. Commit `2db1769f3b7e556d8205646d17c2b2a39c808a9f` was pushed to main. One manual deployment reused the existing service/disk: `dep-dbddesgae00c73fq52q0`, **live** at 2026-10-23T03:42:22.381619Z. SSH confirmed the exact deployed commit. No resources, secrets or account policies were changed.

Public HTTPS checks returned console HTML 200 (login and finance shell), bundled JS 200, health 200, unauthenticated finance 401. Using normal SSH environment credentials privately, login returned 200, authenticated finance returned 200 and logout returned 200. The persisted account had limit/available 1500, reserved/outstanding zero, zero charges and zero batches. This validates console deployment and session/data boundaries; it is not an authenticated visual browser review or a live procurement/payment run. No model call, order or capture was initiated.

P3.4 result/failure presentation and mock rehearsal changes are subsequent local work, not included in this deployed source. Their test evidence is recorded separately in P3 verification.
