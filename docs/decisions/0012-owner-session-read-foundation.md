# ADR 0012: process-local owner sessions and explicit read projections

Accepted 2026-10-23 for owner-authorized P3.1.

## Decision

Exchange the manually supplied owner token at same-origin POST /api/session for a random 256-bit session cookie and a separate CSRF token. Return neither the owner token nor session ID in JSON. Session IDs are stored only as SHA-256 map keys in bounded process memory; the browser receives an HttpOnly, SameSite=Strict, Path=/ cookie, with Secure and the __Host- prefix for configured HTTPS origins. Expiry is a fixed hour. Re-login rotates a presented valid session, logout revokes immediately, and restart revokes all sessions. No SQLite migration or persistent browser credential store is added.

Cookie-authenticated mutations require exact Origin plus X-CSRF-Token. Login itself requires exact Origin and JSON. Existing owner Bearer calls remain an explicit CLI integration contract, with Host/Origin checks; an invalid Authorization header is rejected rather than falling through to a cookie. Owner identity stays bound to the existing single-owner economic database. Callback hints retain their distinct one-time state/order validation and do not gain session or capture authority.

Add allowlisted read models for tasks, audit events and account ledger pages. Never serialize whole rows, raw task input/result, model/provider payloads, payment keys, callback secrets or free-form audit reasons. Audit action/error codes are explicitly whitelisted; unfamiliar messages remain a generic event, not output text. Owner scope is checked in every query. Keyset paging uses committed audit/ledger seq; task listing uses existing SQLite rowid without inventing a historical creation timestamp. No event duplication or financial write is introduced by reading.

## Boundaries and consequences

Process-local sessions fit the existing single-process local deployment. Maximum 100 sessions; 20 failed login checks trigger a 60-second process-local throttle. Restart requires login again but preserves payment state. Multi-instance/shared sessions and production identity providers need a separate requirement. The console must retain CSRF only in memory, submit owner credentials only for the login exchange, and never store the owner token in JavaScript storage.

Audit polling reflects existing committed accounting/purchase/batch events. It is not a fabricated complete mission-event history: P1 does not yet record all plan/task-completion changes in economic_audit. Current task status is read independently; additional mission instrumentation and source-evidence UI belong to P3.2. No UI or automatic procurement/payment is added in P3.1.

See [P3 verification](../p3-verification.md). P2 live evidence is unchanged; local tests use temporary ledgers and mocked services.
