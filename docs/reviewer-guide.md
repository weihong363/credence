# Reviewer setup and demo access

Prepared 2026-10-25. Submission plan: public GitHub source, public YouTube demonstration and Render demo. Repository visibility/video publication are pending. Source is Apache-2.0; dependencies retain their own licenses.

## Hosted demo

https://credence-sandbox.onrender.com/ hosts the working application. The current console requires owner authentication. No public guest mode or isolated reviewer account exists yet. Do not publish or share the deployment's owner token: it authorizes economic mutations. An interactive hosted reviewer-access arrangement must be resolved before submission; a reachable login shell is not a complete unauthenticated demo.

## Local build and deterministic tests

After repository publication, clone https://github.com/weihong363/credence. Until then, access requires repository permission. Use Node 20.19.2 and pnpm 10.33.4.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:production
```

No credentials are required. Tests use temporary state and mocked network ports. Clean-directory reproduction on the development host passed 124 tests; a different physical machine/OS has not yet been verified.

For an interactive **simulated** console:

```sh
pnpm rehearse:console settled
```

Open http://localhost:3198 and use the fake local token printed by that command. This starts an isolated in-memory rehearsal, does not load `.env`, and never calls real PayPal or an LLM. Stop with Ctrl-C. Other scenarios are `empty`, `ready`, `declined`, `unknown` and `action-required`. This is not real payment evidence.

## Real AI and PayPal Sandbox reproduction

Use your own Sandbox REST app associated with one Business receiver and a different Personal buyer. Copy `.env.example` to `.env` only if no `.env` exists. Fill PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MERCHANT_ID, a locally generated OWNER_TOKEN, and your own LLM_BASE_URL, LLM_MODEL, LLM_API_KEY. Keep these exclusively in the trusted backend environment; never paste them into an LLM or frontend bundle. Use a fresh local database, never the deployed ledger.

```sh
pnpm build
pnpm dev
```

Start the server first so it creates the database. In a second terminal, with `DATA_DIR=.data` set in `.env` (as in the template), initialize the same database:

```sh
node --env-file=.env dist/admin/initialize.js 1500
```

Initialization requires an explicit DATA_DIR or CREDENCE_DB_PATH and an existing database. Open http://localhost:3000 and enter your local owner token privately. Start a full review of public `expressjs/cors` pinned to `5317ebe670db2aaebc1d496eb5d33493deefb3ed`, explicitly consenting to source processing and internal spending. Live LLM usage may incur provider charges. Default task budget is 1000 minor units, purchase cap 400, allowance 1500; default services total 750 (USD 7.50). Credit is internal accounting, not lending or PayPal-provided credit.

After three accepted services, select only that task's charges, freeze the bill and create its one Sandbox order. The human Personal buyer approves in PayPal; return to the console, reconcile, review the exact order/amount and explicitly Capture. The backend must independently verify matching COMPLETED status before settlement. Inspect the immutable Order/Capture IDs and restored allowance. Redirect return alone is not payment proof. If status is uncertain, reconcile the original batch; never delete state or create a replacement bill to force success.

This live reviewer path is documented but has not been executed with a separate reviewer's credentials. Historical five-run evidence is in [P3 UI evidence](p3-ui-live-evidence.json); it does not imply production payment support, payouts or split payments.
