# ADR 0015: validated result projection and isolated presentation rehearsal

Accepted 2026-10-23 as the first P3.4 vertical slice.

Expose a read-only owner-scoped task result projection, rather than returning result_json directly. Completed reports must match the immutable source revision and cite only the same task's accepted charged deliveries, covering all accepted deliveries. Full-review results require three accepted deliveries. Bound and project recommendation, summary, findings and limitations; invalid/missing source or malformed reports fail closed as UNAVAILABLE. OPEN and ACTION_REQUIRED never display a completed report. Failure reasons are allowlisted and arbitrary payloads are omitted. No financial transaction or stored report is rewritten.

Present completion separately from payment status; retained accepted charges remain visible even when another service fails. Explain that an OPEN task may be resumed through existing owner tooling with its original bounds, while terminal tasks cannot restart execution. No automatic mission creation, retry, capture or budget change.

Add a development-only CLI rehearsal using isolated in-memory SQLite, explicit fake configuration and existing mock transports. It runs only on loopback, never loads .env or real DB state, labels the served shell as simulated and is excluded from the production compile. Six scenarios exercise empty, approved-ready, settled, declined, lost-capture/unknown and partial-service failure. Fake approvals/receipts do not count toward the real-run gate. Real console task execution and full P3 acceptance remain separate unfinished work.
