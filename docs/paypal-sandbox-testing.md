# PayPal Sandbox testing for judges

Only Sandbox is supported. Configure PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_MERCHANT_ID on the trusted backend. The configured URL must be https://api-m.sandbox.paypal.com. Production credentials must never be used. Never publish buyer passwords, access tokens, the owner token or payment secrets.

1. Create a Sandbox REST app linked to one Business receiver. Obtain its merchant ID from that Sandbox account.
2. Use a different Sandbox Personal account for human buyer approval. Local reviewers should create and control their own test accounts.
3. Configure a separate backend database and initialize a 1500-minor allowance as described in [judge access](judge-access.md). Run the real repository review with your configured model; accept only verified deliveries.
4. Select the task's three accepted charges (125/250/375), freeze USD 7.50 and create its one order. Internal Credit is bounded accounting, not PayPal credit; an accepted service charge is not yet a payment.
5. Open the actual PayPal Sandbox approval link. A human signs in and approves. This login is required; anonymous application access would not remove PayPal buyer authentication.
6. Reconcile in Credence, review the batch/order/amount and explicitly Capture. Only the server's matching authenticated COMPLETED observation can settle the batch. Check its immutable Order ID, Capture ID and three settled charges.
7. Refresh/retry the same completed command or inspect the batch: IDs and confirmation must remain unchanged. Do not create another bill for the same obligations.

Cancellation leaves the bill unpaid; it is not a refund. Declines must not create settlement receipts. Unknown/pending results retain locks; reconcile the original order and do not rebill. Automated tests cover negative paths with mocks; historical live negative evidence is separately identified in the compatibility report. Do not call mocked success real payment verification.

For a hosted test with an operator-provided dedicated buyer, arrange access only through an explicitly authorized nonpublic channel. Limit it to that Sandbox account, rotate after use and keep it distinct from receiver/production accounts. No such credentials have been provisioned or distributed by this work. Public repository instructions must explain the access procedure, not contain credentials. Guest execution is implemented behind JUDGE_MAX_MODEL_CALLS=80; deployment and real guest-payment acceptance must be recorded separately. The judge session needs no Credence registration, but human PayPal buyer login is still required.

Evidence: [five real UI runs](p3-ui-live-evidence.json), [P2 verification](p2-verification.md), [native-versus-internal compatibility](paypal-sandbox-compatibility.md). Existing successful orders are historical evidence, not approval to charge new tasks.
