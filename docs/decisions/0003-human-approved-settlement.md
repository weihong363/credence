# ADR 0003: Human-authorized aggregate settlement

Date: 2026-10-21. Status: P0 consent/capture verified; dynamic implementation selected for P2.

## Context

Agents need autonomy over capability selection, while the owner must retain authority over external payment credentials and consent. A browser redirect or a model statement is not proof of payment.

## Decision

Accrue accepted charges, freeze a batch and create one Sandbox CAPTURE order. The human logs into PayPal as a Personal buyer and approves. A separate owner-authorized backend action captures; independent authenticated inspection validates IDs, amount, merchant and capture status before ledger settlement. Cancellation latches; only explicit owner resume with verified original approval can clear it. Store request keys before network mutation and reconcile uncertain outcomes.

## Alternatives and consequences

Per-tool checkout interrupts useful autonomy. Vaulting/off-session automatic charging weakens the consent boundary and is out of scope. AUTHORIZE/delayed CAPTURE is optional and deferred. Owner participation limits automation and must be scheduled for demos. Agents get no settlement tools, owner token, OAuth token or secret. [Settlement rules](../settlement.md) define races, unknown status and safe retries.
