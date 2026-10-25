# P4 preparation verification

2026-10-25. Local checks only; repository remains private and no license/publication decision is implied.

## Repository screening

Scanned 281 historical blobs reachable through local Git refs. No private-key PEM/OpenSSH headers were found. No tracked `.env`, `.data`, SQLite/database, `.pem` or `.key` paths matched the screening rules. A line-bounded search found no nonempty assignments of 16+ characters to PAYPAL_CLIENT_SECRET, LLM_API_KEY, OWNER_TOKEN or RENDER_API_KEY. Initial six example-file hits came from a whitespace expression crossing blank assignments into subsequent lines; the corrected expression produced no matches. Secret values were not printed or saved in the report.

This is targeted pattern screening, not an exhaustive secret audit: arbitrary credentials, unrecognized formats, unreachable objects, remote-only refs and private data embedded in prose/binary assets are not ruled out. Complete a dedicated pre-publication review before changing visibility. Historical payment evidence is sanitized but still needs owner review for public disclosure. No history was rewritten.

## Clean directory reproduction

Exported committed source `d7520209511bc64dfa2ac6430495694b436b8755` with `git archive` into a new temporary directory. No `.env`, existing node_modules, dist or economic database was copied. Uncommitted P4 documentation drafts were not part of the source export.

Environment: same development host, Node 20.19.2, pnpm 10.33.4. Package-manager cache/toolchain could be reused; this is a clean-directory reproduction, not a fresh physical machine or cross-platform installation.

Commands passed in sequence:

1. `pnpm install --frozen-lockfile`
2. `pnpm check`
3. `pnpm test` — 124/124 passed.
4. `pnpm test:production` — backend/console build, assigned port, health, SQLite persistence, sessions/CSRF and restart revocation passed.

No real LLM or PayPal request was made. Native SQLite loaded successfully on this host. Reviewer-owned-credential live reproduction and isolated reviewer access remain unverified. No personal owner token should be distributed with materials.

## Remaining release work

Choose license/attribution with owner; complete disclosure review and reviewer-access path; record screenshots/video; obtain approval before public repository release, video upload or final submission. P4 remains in progress.

## License and judge preparation follow-up — 2026-10-25

Owner selected Apache-2.0. LICENSE matches the official Apache text byte-for-byte; separate COPYRIGHT attribution uses the existing Git author name Ironion rather than the previously assumed contributors label. Dependency/asset limitations are in third-party-licenses.md. GitHub public API repository lookup returned 404, so public access and GitHub-side license detection are not verified.

Dockerfile/Compose preparation passes `docker compose --env-file .env.example config --quiet`; the Docker daemon socket is unavailable, so image build/container initialization/end-to-end execution remain unverified. `pnpm check`, all 124 tests and `pnpm test:production` pass with the current working tree. No real payment or model request was made.

Registration-free hosted workflow remains unimplemented and blocks primary judge readiness. Current owner authentication is unchanged. No new infrastructure, deployment, public repository visibility change, buyer credential distribution or video upload occurred. See judge-access.md for the required isolated access slice and availability conditions.
