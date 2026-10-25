# 0017 — Isolated judge sessions with a fixed lifetime model envelope

Accepted by owner authorization 2026-10-25: public judge access, at most 80 model requests, and public release after disclosure review.

Keep the existing owner runtime and financial database unchanged. Dispatch /judge HTTP requests to the existing application handlers against a separate SQLite database per guest. These are in-process dispatchers, not additional network services. Guest cookies never authorize owner routes; the trusted dispatcher supplies server-side authority only after guest scope, Origin and CSRF checks. Public requests cannot supply bearer authorization.

A separate persistent admission registry caps lifetime guest sessions at floor(maxCalls/8). One task per session plus the existing durable eight-call task limit gives an upper bound of 80 calls. Sessions that fail, expire or never execute do not reclaim capacity. This conservative bound avoids resetting spending after crash/restart and avoids modifying the verified task/payment ledger schema. A changed configured cap is refused. Fixed repository input and one execution window at a time bound source and execution scope. Short request throttles are process-local; financial and model ceilings are durable.

Guest state is never deleted to retry payments. Existing application settlement, immutable receipts, merchant/amount checks, operation keys and provider reconciliation remain authoritative. Guest callback routing finds its isolated batch; callbacks still require the existing random state verification and never prove payment by themselves. Buyer approval remains human and Sandbox-only.

Tradeoffs: anonymous users can exhaust finite admission slots; sessions expire after 24 hours; one operator instance/disk remains required. No promise of unlimited judge access or cross-device recovery is made. A future quota refill, account recovery or broader fixture selection needs explicit design/authorization rather than deleting state or exposing OWNER_TOKEN.
