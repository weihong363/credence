# Credence demo storyboard

Status: **planned P3/P4 video**, not a description of current UI. Today only the P0 command-line payment flow exists. Target duration **165 seconds**, English narration/captions. Tagline: **Let agents trade capabilities, not credentials.** [Product](product.md), [implementation](spec.md), [run gates](roadmap.md).

## Preparation and reproducibility

Use a public repository whose pinned commit has enough source for the defined evidence checks. Do not invent its findings in advance. Supply operator-owned Sandbox Business receiver, a separate Personal buyer, and a configured live LLM. Seed a fresh mission/account through supported setup APIs, not manual SQL. Account limit 1,000 Credit units, per-purchase cap 400; three services cost 125, 250 and 375 units. Show USD 7.50 outstanding, never imply PayPal supplies that allowance. Capture five consecutive real runs before calling the console stable.

Select the best complete recorded run. A known invalid first delivery can be injected by omitting a required evidence anchor; label it “injected invalid delivery” and show verification rejecting it, then real correction under the same reservation. Do not use mock API or model success to replace live footage. Hide owner sessions, AI keys, PayPal credentials, payer identities and private artifacts. Pause recording while entering buyer credentials; do not cut an unrelated order into a claimed continuous settlement.

## Shot list and narration intent

| Time | Visible action | English narration intent | Evidence to retain |
| --- | --- | --- | --- |
| 0–20s | Mission form: adoption assessment objective and pinned public repository | “Agents need capabilities they do not own. Giving them payment credentials is the wrong control boundary.” | Real task/revision IDs; no fabricated conclusion |
| 20–40s | Owner account policy and agent roles | “I authorize ten dollars of internal allowance, at most four dollars per purchase. This is a spending boundary, not a loan.” | Available 1,000; per-purchase 400; provider allowlist |
| 40–65s | Coordinator reads registry, obtains quotes, reserves inventory service | “The coordinator discovers registered services and proposes purchases. Deterministic policy approves the reservation.” | Quote ID, 125 reserved, provider B invocation |
| 65–90s | B architecture and C independent review execute on actual source; concise decision stream | “Providers do real analysis. The model cannot invent prices, write the ledger or call payment APIs.” | Live model/artifact metadata; second/third quotes 250/375 |
| 90–115s | Invalid delivery rejected, no charge; corrected evidence accepted | “A response is not automatically a valid service. Missing evidence fails acceptance; correction is bounded and charging happens only once.” | Verification reason, unchanged obligation on rejected attempt, one accepted charge |
| 115–145s | Three charges → frozen batch → owner PayPal approval → backend confirmation | “Three accepted services become one human-approved Sandbox payment to our single merchant. The server verifies capture before settling the ledger.” | Exact gross USD 7.50, order/capture IDs, both COMPLETED, no provider payout claim |
| 145–165s | Final adoption report with source evidence; balance restored; repeat settlement shows original receipt | “The coordinator uses purchased evidence to answer the original question. Every service and payment is traceable. Agents trade capabilities, not credentials.” | Accepted artifact references, one capture, Credit restored by settlement |

The report may already be generated before the owner settles; show its result after the payment for narrative clarity without implying the payment caused factual correctness. If real PayPal approval is slow, use a clearly labeled time compression within the same run; never replace it with a simulated completed screen.

## Negative-case fallback and limits

If correction footage cannot fit, show a brief rejected-delivery panel and link its run evidence in the project description. That test remains a P1 acceptance requirement even if the video omits it. If the payment is pending or fails during recording, preserve that outcome, reconcile and record a new successful run; no green success overlay. P0's historical fixture payment is background compatibility evidence, not proof of real agent procurement.

Do not demonstrate AUTHORIZE, interest, installments, real lending, multiple merchant payouts or distributed A2A protocols. The actual behavior is local providers and a single receiver. A hypothetical Alipay extension belongs in written future work, not functioning demo footage.

## P4 publication checklist

- [ ] Functional product exists and P3 five-run gate has evidence.
- [ ] Video under three minutes, English narration or English translation/captions.
- [ ] Only authorized source/assets/audio; sensitive screens hidden.
- [ ] Public YouTube URL replaces [YOUTUBE_URL — pending].
- [ ] Public source URL replaces [PUBLIC_REPOSITORY_URL — pending], with chosen license and complete setup.
- [ ] README identifies live AI, real Sandbox, simulated fixtures and injected failures accurately.
- [ ] Devpost narrative explains problem, target users, innovation, architecture, PayPal/AI integrations, limitations and reproduction path.
- [ ] Reviewer uses own credentials or explicitly approved demo access, never developer personal secrets.
- [ ] Owner approves actual external publication/submission; final rules and deadline checked.
