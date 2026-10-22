# P1 economic core: local verification and live gate

Status, 2026-10-21: **P1 minimum live gate passed** with `deepseek-v4-pro`. A real risk-review procurement-to-ledger-to-cited-report mission completed; inventory and architecture were also independently accepted in retained earlier missions. This historical record was later followed by a real successful three-service task; see [full-review evidence](p1-full-review-live-evidence.json). P2 payments, P3 UI and Render deployment remain outside this change. Evidence: [sanitized live record](p1-live-evidence.json).

## Configuration and commands

Edit the existing local `.env`; never paste keys into chat or commit this file. The existing PayPal configuration is untouched. The P1 CLI does not consume PayPal credentials or call its APIs.

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=
LLM_API_KEY=
```

Fill the model and API key. The [official DeepSeek example](https://api-docs.deepseek.com/) currently lists `deepseek-flash` and `deepseek-v4-pro`; the configured `deepseek-v4-pro` account was live verified; other model/account combinations remain unverified. A base URL ending in `/v1` is also supported if required by another compatible service. Requests append `/chat/completions`; HTTPS is required. The endpoint, model and key are configuration, never model-selected tools. No SDK is required.

`CREDENCE_DB_PATH` is optional (default `.data/credence.sqlite`). Parent directories are created by the mission CLI. Source artifacts are immutable snapshot JSON in SQLite, with per-file SHA-256 and snapshot hash, rather than loose filesystem files. `ARTIFACT_DIR` is not consumed yet. P0's `.data/settlement.json` is separate and never imported.

```sh
pnpm check
pnpm test
pnpm test:production
# Public GitHub read only, no model or PayPal calls:
pnpm verify:source
# Explicit real model run, after local configuration:
pnpm mission expressjs cors 5317ebe670db2aaebc1d496eb5d33493deefb3ed
pnpm economy status
```

The mission command starts a new task each time; it is not a replay key. Do not rerun it to recover an interrupted task. It can incur model API charges and internal accepted service obligations. All three services cost 125+250+375=750 units (USD 7.50 accounting equivalent), within the default 1,000-unit account and 400-unit purchase cap. The coordinator chooses purchases, so do not assume all three ran: inspect actual accepted delivery IDs, purchase states and charges. The final report must cite only accepted deliveries. A COMPLETED task means synthesis/schema checks passed; it is not a claim semantic conclusions are independently true. P1 live acceptance must also inspect the useful report and source evidence.

Accepted charges persist even when later synthesis fails. Insufficient-evidence, timeout, invalid output, exhausted budget and missing credentials never imply a successful service or payment. P1 does not restore outstanding credit: P2 settlement is not implemented. Never clear a financial database to force another run.

## Cancellation and crash recovery

Run one local coordinator/runner at a time. Stop normal work before recovery. Jobs are durable invocation rows; transactions never include network calls. Leases last 30 seconds and heartbeat every 10 seconds. Crash recovery reuses the invocation ID and has at most two execution attempts total, including a correction. No exactly-once external compute claim is made.

```sh
pnpm economy cancel PURCHASE_UUID
# Reconcile deadlines/policy and mark expired leases ready; no model calls:
pnpm economy recover
# Resume an OPEN task after a crash, using its persisted snapshot and request budget:
pnpm economy resume TASK_UUID
```

An unexpired RUNNING lease returns `MISSION_BUSY_WAIT_FOR_LEASE`; wait for expiry. Recovery never extends the original 90-second purchase / five-minute task deadline. A failed terminal task returns its recorded result; it is not silently reopened. Completed-task resume returns the recorded report without model requests. If the process died before persisting a snapshot, resume fails visibly; it does not invent source evidence. All remote model requests, including retries, claim the durable eight-call task budget before sending. Reconnection does not reset that budget or the one coordinator JSON repair.

## Evidence collected

Final local checks: `pnpm check` PASS; `pnpm test` **56/56 PASS**; `pnpm test:production` PASS (compiled P0 process, assigned port, health, state persistence and graceful restart); `git diff --check` PASS. Automated tests made no real model or PayPal requests; the separately recorded live runs called DeepSeek and GitHub, never PayPal.

| Check | Evidence | Limit |
| --- | --- | --- |
| USD, account/task bounds, replay, atomic rollback | Real temporary SQLite tests | No lending or external funds |
| Competing holds | Two processes: 70 and 40 against 100, one winner | Local filesystem; not distributed SQLite |
| Registry/quotes/policy | Unknown/version/expiry/owner/allowlist/cap denials, consumed quote uniqueness | Internal CLI/application services, no HTTP procurement API |
| Invocation restart | Close/reopen DB, expired lease reacquisition with same ID, stale completion ignored | Remote compute may run again |
| Cancel vs accept | Two competing processes, exactly one release or charge | Local transaction ordering |
| Delivery/charges | Schema, source revision/hash, exact line anchor, claim indices; one correction; immutable delivery/verification/charge rows | Objective evidence does not prove semantic quality |
| Failure paths | Exception, timeout, revoked account, late result, injected accept-audit failure and reconciliation mismatch | Network/provider responses mocked in automated suite |
| Full offline mission | Mock coordinator/providers choose three services, accept 750 units, synthesize cited report | Not a real AI run or genuine risk conclusions |
| Real public source | `pnpm verify:source`: expressjs/cors at `5317ebe670db2aaebc1d496eb5d33493deefb3ed`, 16 files, 59,570 source bytes, one exclusion; inventory PASS | No model calls, no code execution, no PayPal |
| Native model adapter | Live DeepSeek authentication, registry choices, architecture/risk output and final synthesis; mock tests cover budgets, errors, truncation and endpoint isolation | Successful model is deepseek-v4-pro; semantic conclusions require review |
| Existing payment flow | P0 regression tests and compiled process restart smoke pass | No fresh Sandbox payment |

The source fetch uses public GitHub only, refuses redirects/private repos/traversal/symlinks, pins a 40-character commit, validates Git blob SHA-1 and file SHA-256, and bounds text to 100 blob requests / 100 files, 200 KiB each, 1 MiB total and a 60-second fetch deadline. GitHub rate limits can cause a visible SOURCE_HTTP_403/429; wait for reset. This fixture uses 19 public API requests. No repository instructions or code are executed. The mission CLI optionally reads server-only `GITHUB_TOKEN` to avoid unauthenticated rate limits; its fetch wrapper permits only `https://api.github.com` and denies redirects. It is never sent to the model.

## Live outcome and remaining limits

Successful task: `8891b9e3-2820-4524-a787-f8c09a94904a`; accepted risk delivery: `16810fe0-e9e9-4ee1-91cd-d1436c8ceb33`; four model requests, one 375-unit accepted charge and a cited ADOPT_WITH_CONDITIONS report. The owner objective for this task explicitly requested only independent risk review, within the remaining allowance. It is a real single-service continuation gate, not evidence of a complete three-service mission.

Architecture was independently accepted in task `baf26f38-8d67-4a9b-b83c-af0ebbf5927a`, delivery `415d1c17-31ee-42e6-9da1-eaeb77e07947`. Three genuine inventory deliveries were accepted across retained attempts. All five accepted charges revalidated against immutable snapshots. Closing/reopening SQLite and resuming the completed task returned the unchanged report with zero additional model calls. Reconciliation passed.

Failures are retained: unauthenticated GitHub quota (403), missing source identity in a model report, a coordinator idempotency key incorrectly shared across separate tasks, malformed/incorrect evidence, insufficient risk coverage and incomplete final responses. Fixes include optional fixed-host GitHub credentials, task-scoped proposal keys, explicit repository identity and task input, numbered-source evidence selection, concise final synthesis, and DeepSeek JSON/non-thinking mode per [official API](https://api-docs.deepseek.com/api/create-chat-completion/). No verifier rule was relaxed and no ledger history was edited to turn failures into successes.

The provider now selects `{path,line}` from numbered source. The server extracts the exact immutable source line into the delivery envelope; it does not repair arbitrary model anchor text. Verifier hash/path/range/anchor and cross-file risk requirements remain unchanged. Rejected outputs do not charge. The model receives no GitHub/PayPal/owner credentials.

Account after all retained live attempts: limit **1,000**, reserved **0**, outstanding **1,000**, available **0**. This comprises inventory 125×3, architecture 250 and risk review 375. Earlier accepted inventory remains payable even when its enclosing mission failed. These are internal accounting obligations; **zero PayPal requests** occurred in P1. Do not start more paid work or clear state to reset allowance. P2 settlement/explicit owner policy work remains separate.

Quality limitations matter: exact evidence proves source provenance, not claim truth. The report infers project inactivity from the latest HISTORY.md release entry; current maintenance activity was not independently established. Broad CORS defaults and legacy Node compatibility are conditional adoption caveats, not proven vulnerabilities. The report is useful as a bounded review with these caveats, not a security certification. A successful single-task three-service review and five consecutive full settlement demos remain later acceptance work, not claimed here.

## Planning change after this historical live record (2026-10-22)

The live records above predate the new plan/profile implementation and are not rewritten. CLI missions now request full-review and require all three accepted services plus complete final report coverage. New planning uses one immutable plan, reserves the final request and exposes request purpose in SQLite. Limited programmatic objectives remain scoped. See [ADR 0009](decisions/0009-bounded-review-plans.md) and [current follow-up status](p1-three-service-follow-up.md): 66 local tests pass; the owner then authorized a 1,500-unit independent account and a real full review passed in five requests. See [current live evidence](p1-full-review-live-evidence.json). Original ledger/history remains unchanged and no PayPal requests occurred.
