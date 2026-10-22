# Economic accounting and settlement specification

Status: planned P1/P2 authority, 2026-10-21. Current P0 behavior and its narrower guarantees remain documented in the [compatibility report](paypal-sandbox-compatibility.md). Schema and contracts: [spec](spec.md). P1 implements reserve/release/accepted-charge accounting and reconciliation with local SQLite tests (ADR 0008). The minimum real AI procurement/report gate passes; dynamic settlement is P2 and not implemented.

## Definitions and money

**Credit** is the owner's bounded permission to incur internal service charges. It is not funds, financing, PayPal Credit, a bank line or an AI entity's legal borrowing. **Reservation** temporarily holds allowance for a quoted purchase. **Charge** is an immutable amount created only for an accepted delivery. **Outstanding/payable** is the sum of accepted service obligations not yet cleared by verified settlement or an approved pre-payment correction. **Allocation** locks one whole charge into a frozen **settlement batch**. **Payment confirmation** is an authenticated backend observation of a completed provider capture. **Settlement** atomically applies that confirmation to the frozen allocations and clears the internal payable once.

MVP: USD only; integer minor units, 1 Credit unit = USD 0.01; no FX, fees charged to providers, tax engine, discounts, partial payment or split allocation. PayPal receiver fees do not reduce the internal amount: reconcile gross captured USD, not the merchant's net balance. Store prices and account policy in the same unit; validate safe integer arithmetic and the 1,000,000,000 cap from the spec. Parsing PayPal values uses strict decimal-string syntax with exactly two fractional digits and integer conversion; reject exponent, negative, comma, trailing characters or wrong currency. Never use parseFloat multiplied by 100.

## Allowance and ledger invariants

For an account: L = authorized limit, R = sum HELD reservations, O = sum accepted uncorrected charges − settled allocations. Available A = L − R − O. All quantities are nonnegative; R + O ≤ L at every committed transaction. Default demo L=1,000, per-purchase cap=400; limit lowering below R+O fails. Task budget consumption includes held, accepted and settled purchases during that task; settlement restores account availability, **not** the mission's lifetime spending budget. Corrected pre-payment charges restore that task's consumed amount; paid/refunded work never authorizes extra autonomous purchases within the same mission.

| Event | Related resource | Delta R | Delta O | Preconditions / uniqueness |
| --- | --- | --- | --- | --- |
| CREDIT_RESERVED | reservation, purchase, task | +price | 0 | One event per reservation, active account/quote, A and task budget sufficient |
| CREDIT_RELEASED | same reservation/purchase/task | −price | 0 | HELD only, one release, failed/rejected/cancelled/expired purchase |
| SERVICE_CHARGED | charge, accepted purchase/delivery/task | −price | +price | HELD→CONSUMED, one accepted charge per purchase; this event consumes the reservation |
| SETTLEMENT_ALLOCATED | charge, batch, purchase/task | 0 | 0 | Whole outstanding charge, one active allocation; immutable frozen amount |
| ALLOCATION_RELEASED | charge, batch, purchase/task | 0 | 0 | Only when no remote order was ever attempted, or authoritative nonpayable closure is independently proven |
| PAYMENT_CONFIRMED | payment attempt, batch | 0 | 0 | One completed capture ID, independent verification, amount/merchant match; batch-level event references allocations for task lineage |
| CHARGE_SETTLED | allocation, charge, purchase/task | 0 | −price | One per allocation, same transaction as confirmation/batch finalization |
| CHARGE_REVERSED | original charge, purchase/task | 0 | −price | Pre-payment owner correction only, no active/final allocation; exact full reversal once |
| REFUND_OBSERVED | original payment, batch, affected purchase/task links | 0 | 0 | External refund verified by owner reconciliation; no new charge or automatic rebill |

Payment confirmation does not subtract outstanding a second time. Allocation does not consume a reservation. Ledger append, projection updates, unique keys and job changes commit in one SQLite transaction. No remote calls run inside it. Each reservation reaches CONSUMED or RELEASED once; each accepted delivery yields one charge; each charge is either outstanding, reversed or settled, never two at once. Every per-charge event references purchase/task. Batch-level events reference the complete immutable allocation set, preserving lineage for all included tasks.

Use BEGIN IMMEDIATE to read authoritative account/quote/task state, validate, claim unique purchase, conditionally update balances, insert reservation and ledger event, and enqueue invocation. A competing connection waits or retries a bounded busy error, then observes the new balance; it cannot use a stale read. Acceptance consumes the reservation and inserts the charge in one analogous transaction. Acceptance and cancellation compare purchase version/status inside the transaction, so one winner determines the outcome.

Ledger rows are append-only with dedupe_key and payload hash uniqueness; corrections use reversal_of references. DB triggers prohibit UPDATE/DELETE of ledger events and immutable financial rows. Mutable account/batch/job projections are operational state; account policy changes and cancellation/resume append audit records. A projection may be rebuilt without changing historical events. Integrity is enforced against application bugs, not a database administrator with unrestricted filesystem control.

Reconciliation independently recomputes R/O from events and compares reservations, charges, allocations and account projections. Settled batch total equals sum frozen allocation amounts equals verified gross capture. SQL constraints plus reconciliation tests must catch duplicate consumption, orphan charge, double release, wrong-currency event, partial allocation, total mismatch and settlement without confirmation. Use deterministic failing fixtures, not manual financial-row repair.

## Delivery rejection, correction and disputes

Failed transport has no delivery acceptance. A schema-valid object with nonexistent citations fails objective acceptance. Subjective quality review can request one correction within the original purchase deadline; it cannot silently auto-charge. Final rejection, deadline or owner cancellation releases the hold and produces no charge. Correction reuses the purchase/reservation and immutable quote; each delivery attempt gets its own row. Late outputs cannot resurrect cancelled/rejected purchases.

A later dispute does not erase an accepted delivery. Owner can reverse a full unpaid, unallocated charge with a reason, append CHARGE_REVERSED, and update outstanding once. If allocated, resolve the batch first; if payment is unknown, keep it locked. After settlement, purchase and charge remain historical accepted/paid records. MVP has no programmatic refund endpoint: owner handles a refund through Sandbox and records a manually initiated authenticated reconciliation; unresolved refund/mismatch blocks automatic settlement changes and displays action required. Never imply a credit note refunds PayPal. Refund automation, partial refunds and automatic recharging are deferred.

## Batch formation

Owner supplies explicit charge IDs; never accept a frontend total or receiver. Transaction checks same owner, account, USD and configured single merchant; each charge has accepted delivery, is uncorrected/unsettled and has no active allocation. No partial charge allocation. Compute total with checked integers, freeze sorted charge IDs/amounts, store allocation hash and immutable total, insert LOCKED allocation rows and SETTLEMENT_ALLOCATED events. Different request keys racing on the same charges cannot bypass the partial unique index.

Frozen contents never change; later charges require another batch. No mixing currencies, owners, accounts or receiver configurations. Frozen batch count can grow over time, but a charge is allocated exactly once unless a proven safe pre-payment release appends the matching event. A cancelled checkout retains its batch, amount, obligations and original remote IDs. Do not automatically release charges and allocate them to a new order.

## Separate payment and batch lifecycle

Batch states: FROZEN, AWAITING_APPROVAL, CAPTURING, PAYMENT_PENDING, UNKNOWN, CANCELLED, ACTION_REQUIRED, SETTLED, RELEASED. Provider observations retain normalized statuses and original safe state codes separately. “Approved” means consent, not a paid ledger.

| Transition | Trigger / conditions | Effects and recovery |
| --- | --- | --- |
| FROZEN → AWAITING_APPROVAL | Owner order request; confirmed create response | Order/approval URL bound to batch; allocations stay locked |
| FROZEN → UNKNOWN | Create may have reached PayPal but response ambiguous | Persist first-attempt timestamp and same keys; never create a replacement batch/order blindly |
| AWAITING_APPROVAL → CAPTURING | Owner capture intent; inspect proves APPROVED, matching batch/amount/merchant, not cancel-latched | Persist capture intent/key before POST; no new reservation or charge |
| CAPTURING → SETTLED | Fresh authenticated GET proves exactly one matching completed capture | Atomic PAYMENT_CONFIRMED + per-charge CHARGE_SETTLED, projections and receipt |
| CAPTURING → PAYMENT_PENDING/UNKNOWN | Pending provider status, timeout, unreadable/mismatched response | Keep charges locked/outstanding; schedule inspect, no receipt or allowance restore |
| Any unpaid locked state → CANCELLED | Owner or validated cancellation callback; serialize against capture | Latch cancel, append audit; no new capture initiation; not remote void/refund |
| CANCELLED → AWAITING_APPROVAL | Explicit owner resume; inspect original order proves APPROVED | Clear latch with audit, retain same attempt keys; separate owner capture action |
| UNKNOWN/PAYMENT_PENDING/CANCELLED → SETTLED | Reconciliation proves capture already completed | Account for actual payment even if cancellation arrived after remote capture |
| Any unpaid locked state → ACTION_REQUIRED | Definite failure, mismatch, expired retry window or bounded retries exhausted | Owner sees reason; preserve allocations and identifiers |
| FROZEN → RELEASED | Owner abandons before any create attempt was persisted | Release allocations via compensating events, leaving charges outstanding |
| ACTION_REQUIRED → RELEASED | Owner reconciliation proves original order cannot now capture and no capture exists | Explicit evidence/audit, otherwise remain locked; MVP need not automate this branch |

Cancellation before capture intent commits prevents the job. Once a capture POST may have been sent, cancellation cannot guarantee no payment; reconcile and record actual outcome. Local worker rejects duplicate/in-progress capture requests and persists a bounded lease. Crashed capture jobs perform GET before retry. A delayed callback cannot clear cancel_latched. A SETTLED receipt is immutable; later GETs append observations for refunds/disputes without rewriting its verified-at timestamp or charging again.

```mermaid
sequenceDiagram
  participant H as Human owner
  participant S as Settlement service
  participant D as SQLite / ledger
  participant P as PayPal adapter
  H->>S: Freeze accepted charge IDs
  S->>D: Lock allocations, compute and freeze total
  H->>S: Create order
  S->>D: Persist order attempt and stable create key
  S->>P: Create one order
  P-->>S: Order ID and approval URL
  S->>D: Persist association
  H->>P: Personal buyer approves
  H->>S: Request capture
  S->>P: Inspect approval and mapping
  S->>D: Persist capture intent/key
  S->>P: Capture existing order
  S->>P: Independent authenticated GET
  alt One matching completed capture
    S->>D: Atomic confirmation, settle allocations, restore allowance
    S-->>H: Immutable receipt
  else Unknown or pending
    S->>D: Keep obligations locked; schedule reconciliation
    S-->>H: Action required / pending, never success
  end
```

## PayPal mapping and business idempotency

One purchase_unit, intent CAPTURE, payee = configured receiver Business merchant; custom_id and invoice_id = immutable batch UUID. Amount = full frozen USD total as decimal string. Use one order and one full capture per batch; reject multiple/partial captures rather than inferring settlement. The provider-neutral port returns normalized observations; economic code never manipulates OAuth tokens or raw PayPal objects. Explicit owner approval remains on PayPal's page. No vaulting, billing agreements or off-session charging.

Persist a payment_attempt before network mutation, with distinct UUID create_key/capture_key and first-attempt times. Provider order IDs and capture IDs are unique across all batches. Business dedupe includes quote consumption, purchase identity, active charge allocation, one payment attempt per batch, ledger event dedupe and one capture confirmation. A repeated owner HTTP key with a different payload fails. A new owner HTTP key cannot defeat business uniqueness.

Use the P0 transport's bounded retry behavior as baseline. P2 adds Retry-After support with bounded wait (maximum 30 seconds per attempt); on larger waits persist next_attempt_at and yield. Max three transport attempts, 15-second per-request timeout, stable POST key; do not keep a request open indefinitely. 401 renews server token; 429/5xx/timeouts retry within bounds; definitive 4xx errors become action required, not automatic new attempts. Deadline recovery uses a five-hour mutation retry cutoff from first attempt, conservatively below the documented default Orders six-hour request-ID retention; recheck provider documentation/app policy before live P2 acceptance. After cutoff, GET reconciliation only; human investigation cannot blindly rotate keys.

A lost create response without an order ID is the hardest case: replay the original create/key inside retention. After expiry, lock indefinitely for manual provider reconciliation; invoice uniqueness is a secondary safeguard, not a discovery API or an unlimited dedupe promise. A lost capture response with known order ID is reconciled by GET; completed capture finalizes once. A local crash after PayPal success but before ledger commit is fixed by replaying the finalization transaction after GET; unique capture/allocation events prevent double accounting. No distributed exactly-once claim is made; local effects are effectively once through reconciliation and uniqueness.

## Error and event matrix

| Condition | Economic behavior | Recovery |
| --- | --- | --- |
| Credit exhausted / per-purchase limit / allowlist / revoked | No reservation or provider call | Owner changes policy or starts eligible task |
| Expired quote | No purchase; previous quote remains historical | Request new quote; do not alter its amount/expiry |
| Provider timeout / partial service failure | Release failed purchase reservation; keep other accepted charges payable | Retry/correct only within documented bounded lifecycle; task explains missing result |
| Buyer cancels / approval abandoned | Charges remain outstanding and allocated; no capture initiation while latched | Explicit resume of original approved order; never new payment silently |
| Definite order create error | No settlement; keep frozen allocation and audit | Correct configuration and retry same attempt safely; record reason |
| Capture decline / pending | No allowance restoration or settled flag | Reconcile; buyer may need new approval; same batch and order |
| API timeout / unknown or mismatched total/merchant | Locked outstanding obligations, action required | Independent GET and exact comparison; no fabricated receipt |
| Duplicate user request | Return existing resource/current state | Same body/key replay or business uniqueness |
| Repeated webhook | No duplicate financial effect | Event ID inbox + capture/ledger uniqueness; inspect provider |
| Delayed webhook / webhook absent | No reliance on arrival | Poll/reconcile after owner return and on recovery |
| Refund/dispute after settlement | Preserve original receipt and append observation; no rebill | Owner reconciliation and explicit external refund strategy |

Webhook ingestion is **deferred**, not a requirement for the local MVP: polling after owner actions plus durable restart reconciliation is the authoritative path. No P0 webhook endpoint exists. If later enabled, require PayPal signature verification with configured webhook ID before trusted processing, persist event ID/hash in webhook_inbox, ignore replays, quarantine same-ID/different-hash, enqueue inspect, and never settle solely from webhook payload. Delays or repeats do not change invariants. An unsigned endpoint is not an acceptable shortcut for the demo.

## Reconciliation tests and financial limits

Required tests: reserve/accept/reject balance deltas; parallel reservation overspend; two batches allocate one charge; repeated confirmation transaction; amount/currency/merchant mismatch; accepted versus rejected charge selection; unknown order blocks reallocating; expired mutation windows; callback/owner cancel race; duplicate/delayed events; rollback at every finalization write; crash around remote checkpoints; projection replay equals persisted balances. Opt-in live P2 evidence must include three **real accepted** service charges and one completed payment, separately from P0 fixtures.

One merchant-of-record Sandbox account receives the gross aggregate test payment. There are no real payouts to independent agents/providers; the ledger expresses internal service economics only. Commercial use, real merchant onboarding, legal obligations and regulated financing are outside this prototype's claims. Do not promise settlement of real provider balances or automatic recovery from insufficient buyer funds.

## Full-review planning boundary

New mission planning/profile and model-budget reservation follow ADR 0009. A plan is permission to attempt individually checked quotes, not a charge or a promise of settlement. A full-review failure retains already accepted charges, releases unfinished holds, and never resets task/model spending on restart. Final synthesis capacity does not restore Credit or imply a payable delivery. No P2 settlement behavior is added by this change.

Owner-authorized allowance updates use a policy transaction, not a charge/settlement event. The application validates owner, checked USD minor units, existing reserved/outstanding amounts and the per-purchase bound; limit mutation and audit commit together. The explicitly authorized 1,500-unit independent verification account does not alter or settle the original account.
