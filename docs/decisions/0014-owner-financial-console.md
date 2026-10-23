# ADR 0014: explicit owner finance controls over existing settlement authority

Accepted 2026-10-23 for P3.3.

Expose a dedicated owner-scoped financial read projection and reuse the existing authenticated P2 command endpoints for freeze/order/capture/reconcile/cancel/resume. The projection omits raw payment observations and internal keys, whitelists approval-link origin and provider status, and shows receipt IDs only when the application has finalized a verified capture. Resolve batch IDs on allocation ledger rows at read time. No migration or financial-history rewrite.

Browser command keys are SHA-256 identities of the exact path/body. Freeze canonicalizes charge ordering. Versioned commands retain expectedVersion in their identity; no client-generated price/receiver is submitted. These browser command identities do not replace the server's durable PayPal operation keys or database uniqueness/lease controls. Disable simultaneous local submissions, retain explicit capture amount/batch/order review, reject stale versions server-side and refresh authoritative state after every returned or interrupted command.

Display cancelled/unknown/pending/action-required separately from settled. Opening PayPal does not prove approval/capture; capture is available only after server inspection has reported APPROVED and still requires an owner click. Polling is read-only. Reconcile can resolve a lost capture without another debit. When an order ID is unknown, preserve the frozen obligations and require investigation; no replacement-order control is introduced. Account limits/status are read-only in this slice. Tests use mocked payment transport and temporary ledgers. Existing PayPal adapter, finalization and historical live evidence remain unchanged.
