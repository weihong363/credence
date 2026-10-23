# Credence repository instructions

## Scope and authority

Read README.md, docs/spec.md, docs/settlement.md and docs/roadmap.md before implementation. Product scope is in docs/product.md; ADRs explain decisions. The payment compatibility report and evidence JSON describe P0 history, not implemented Agent Runtime capabilities. Document status must distinguish implemented, locally tested, live verified, planned, unsupported and deferred.

Documentation/planning does not authorize phase implementation; explicit deployment-preparation requests may add only the configuration and minimal server adaptations they require. Cloud resource creation/deployment needs owner approval. Do not implement P1–P4 until the owner explicitly approves. Once authorized, complete one vertical slice and its acceptance checks before the next. Do not add optional AUTHORIZE, distributed infrastructure, Alipay or marketplace behavior while core invariants are incomplete.

## Coding conventions

Prefer TypeScript, ESM, explicit public types, functional patterns, native APIs and pnpm. Keep functions small and focused, ideally at most 30 lines. Make the smallest complete change. Start from directly related files, avoid global refactors and unnecessary dependencies. State the intended approach briefly before edits. Never read `.env` into tool output, inspect unrelated files, or change payment evidence to make a test pass.

## Modules and trust

Current modules include src/server.ts, src/runtime-http.ts, src/application, src/persistence and src/payments. Historical P0 remains in src/phase0-server.ts, src/http.ts and src/settlement.ts; src/paypal.ts is the reused transport. The planned module map is in docs/spec.md; do not pretend those directories exist. Preserve the verified P0 transport and evidence. New economic modules must not import raw PayPal types. Only application services own financial transactions; providers and LLM tools may not write the ledger or invoke capture. Keep future HTTP handlers thin. SQLite transactions contain no remote API or LLM calls.

No microservices, Kubernetes, blockchain, generalized plugin framework or compatibility facade without a concrete requirement. P1's SQLite repository and append-only ledger are justified by reservation correctness. P0 remains an isolated spike until the documented P2 cutover; it must never process the same obligations as the new runtime.

## Commands actually available

- `pnpm install --frozen-lockfile`
- `pnpm check`: TypeScript no-emit validation.
- `pnpm test`: Node tests through tsx; no credentials required.
- `pnpm dev`: local P2 SQLite settlement server; loads `.env` and requires valid configuration.
- `pnpm dev:phase0`: explicit isolated historical P0 server.
- `pnpm settlement`: local owner batch/payment status, order/capture/cancel/resume/reconcile/recover and unallocated-charge reversal.
- `pnpm verify:phase2 BATCH_ID`: opt-in independent Sandbox GET and settled-only replay verification; requires explicit CREDENCE_DB_PATH.
- `pnpm verify:phase0`: live read/repeat verification, requires settled local bill and running server.
- `pnpm verify:phase0 --negative`: official Sandbox decline injection against the completed order.

`pnpm build` compiles the backend, `pnpm start` starts dist/server.js from environment variables, and `pnpm test:production` checks the compiled process using fake credentials and temporary state. No lint, migration or browser-test command exists yet. Introduce and document commands only with their implementation. Never run a fresh payment to validate documentation changes.

## Economic invariants

Use nonnegative safe integer minor units, USD only in the MVP. Credit is a bounded internal allowance, not financing. Enforce account and purchase limits atomically. Available = limit − reserved − outstanding. Accepting a delivery moves reserved to outstanding exactly once; rejection/cancellation releases reservations. Only accepted charge entries can be allocated to a frozen batch. One charge has at most one active allocation and one final payment allocation. Uncertain payments remain locked and cannot be rebilled. Settlement requires independent authenticated provider verification. Corrections append events; no silent deletion or rewriting of financial history.

Model text, schema success and payment success are not delivery-quality proof. Validate authoritative capability IDs, versioned quotes, policy, schemas, evidence anchors and task ownership. Do not store model chain-of-thought; retain concise decision summaries. Enforce deadlines, retries and budgets deterministically.

## Security

Never expose PayPal secrets, access tokens, owner credentials, database handles or unrestricted financial tools to LLMs, providers or browsers. `.env`, `.data`, future databases and artifacts remain excluded from publication. Avoid logging raw remote responses, prompts containing private source, or authentication headers. Agents never call settlement owner APIs. Browser redirects/webhooks are hints until verified; ignore unverified or duplicate events. Use constant-time byte-safe credential comparison and CSRF protections when adding browser sessions. Bind local development to loopback; external deployment is a separate explicit scope.

Do not erase the P0 ledger, rotate its operation keys or remove a live process lock to force a retry. No live PayPal API, lending, payouts, automatic debits or undisclosed model usage. Do not send messages, publish code or submit the project without applicable user authorization.

## Definition of Done

Implement only the approved slice. Run current type checks and meaningful unit/integration tests. Financial changes require concurrency, replay, rollback and reconciliation tests, not only happy-path checks. Record mock versus live evidence, failures, remaining risks and exact commands. Update roadmap checkboxes only after acceptance succeeds. Keep README, spec, settlement rules, schema and APIs consistent; add an ADR for changes to established decisions. Preserve historical P0 evidence and never relabel its simulated service charges as real procurement. Stop at phase gates when blocked or awaiting the next explicit scope approval.
