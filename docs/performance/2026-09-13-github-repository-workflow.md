# GitHub connection and repository workflow — 13 September 2026

## Observed production failure

The installed RIFT UI Preview Connect action opened GitHub's own **Page not found** page, before consent. An independent server request to GitHub's token endpoint with the configured client ID/secret and a deliberately invalid code returned HTTP404, instead of the expected invalid-code response for a valid client pair. No credentials were printed. This is an external OAuth app configuration failure, not evidence of a sidebar rendering failure.

A new RIFT OAuth app was registered in the signed-in GitHub account. Exact callback URLs are registered for `https://riftsys.app`, `http://localhost:3020`, and `http://localhost:3022`, each at `/api/github/callback`; wildcard matching remains disabled. GitHub requires account re-verification before generating its client secret. Until that step is complete and credentials are installed, live account linking is **not verified**. The existing invalid pair has not been substituted with a partial new pair.

Run `node scripts/check-github-oauth.cjs` against the deployment environment to validate the client pair without issuing an access token. This check does not prove consent or callback behavior; those still require a real browser round trip.

## Changes

- The sidebar offers an explicit Add repositories picker. Repositories are loaded on demand, can be searched and paginated, and expose Added/Open states. Adding persists a project; opening resumes a project chat or starts a new chat with that project context. Existing Projects navigation owns the selected repository rows.
- Selection is matched by GitHub's stable repository ID in the authenticated user's project subscription, including renamed RIFT projects. Requests and pending local additions reconcile with that subscription.
- Both web and desktop start OAuth through an authenticated same-origin POST. All server credentials are checked before leaving RIFT. The desktop opens GitHub in the system browser and retains the existing signed native return nonce.
- A signed OAuth state alone did not prove the callback came from the initiating browser. Web completion now also requires a short-lived HttpOnly cookie and the matching authenticated account. Desktop callbacks stage an encrypted authorization code behind a one-use, account-bound ticket; credentials are exchanged and saved only after the initiating desktop returns and authenticates. Tickets expire and are cleaned up automatically.
- Authorization errors remain visible in the connection dialog. The public build-time client-ID flag is removed. PAT fallback verifies the account before saving, preserving editable input on errors.
- The callback distinguishes cancelled access, invalid app configuration, expired authorization, provider availability and storage failure. Provider calls have timeouts, reject redirects, bypass cache, and never log raw credential-bearing exceptions. A connected result requires verified account identity and successful storage.
- OAuth refresh tokens and expiry are stored server-side. Refresh uses a per-connection database lease and versioned compare-and-swap, so concurrent workers, reconnects and disconnects cannot overwrite one another's credentials. Legacy PAT connections remain supported.
- Once a refresh may have rotated credentials, an uncertain response or persistence failure cannot return the previous pair. Persistence retries use the same guarded payload and lease within a bounded window. If the new pair cannot be saved, reconnecting may still be necessary; this is not an outage-proof credential recovery system.
- Newly OAuth-connected GitHub MCP plugins store an encrypted reference to the owner's GitHub connection and obtain current credentials for each request. Runtime callbacks retain their original database and key context. Disconnect fails closed; manual/custom tokens remain unchanged. Older static OAuth plugin copies require one explicit reconnect because they cannot safely be distinguished from manual tokens.
- Repository-bound cloud tasks verify current GitHub access and stable repository identity before preparing an isolated checkout. Existing files, branches and uncommitted changes are preserved. Preparation never pulls/resets/cleans existing work and does not initiate project build or install scripts. Local execution retains its local workspace rather than allocating a cloud sandbox.
- The verified checkout becomes the run-specific default working directory for cloud commands, PTYs and relative file operations. Explicit paths still win; there is no process-global directory mutation. Interrupted completed clones recover only after provenance, origin, HEAD and clean-state checks; incomplete or changed work is preserved.
- Repository listing and adding have bounded waits and keep retry controls available. Closing the picker or disconnecting discards late responses. Mobile search uses 16px text to avoid focus zoom on iOS.

## Verification bounds

UI browser fixtures import real production components and use mocked authentication/GitHub responses. Repository preparation tests execute real git subprocesses against temporary local fixture repositories through a sandbox adapter. These validate behavior and failure boundaries, not real private-repository access in E2B.

Recovery checks use Git to verify a staged checkout. Git configuration can influence those commands (for example, configured filters or fsmonitor); these checks are not a security sandbox for a compromised existing Git configuration.

Live GitHub consent, native return, actual repository selection and a real repository-bound cloud task remain pending the account re-verification/client-secret step. No claim of end-to-end live completion is made by passing fixture tests.

## Follow-up verification

The configured pair still returns `github_app_not_verified` with HTTP404 (client-ID fingerprint `d4d4419af3`). The signed-in owner's settings for OAuth app `3854544` show the registered exact callbacks and no generated client secret. Selecting Generate a new client secret opens GitHub's Confirm access page; no verification email, code or mobile prompt was sent by the agent. The browser is left at that page for the owner. No partial client-ID/secret substitution was made.

A fresh read-only audit passed 130 tests across 12 focused suites covering OAuth initiation/completion, the repository picker, sidebar project binding, repository access and actual Git checkout preparation fixtures. These tests do not remove the live prerequisite above.

## 14 September: client credentials repaired

The owner completed GitHub account verification. A new secret was generated for the registered app and installed in the local release environment without printing it. `check-github-oauth.cjs` now returns `client_credentials_valid` (HTTP 200, client-ID fingerprint `f25f39d6eb`). This supersedes the previous HTTP404 configuration blocker. The production domain environment has not been changed by this local operation.

Published `.next-ui-release-1789388647378-pre-effects` after the fresh execution/cleanup inventory passed; localhost:3020 returns HTTP200. The build also includes Hack Workbench's shared scroll/anchor integration. Focused UI tests passed 78 cases, GitHub backend tests passed 68 cases, and GitHub browser fixtures passed 22 cases (2 skipped). The mobile scroll lab check timed out waiting for `scroll-surface`; it is not a passing live scroll check.

Live OAuth consent, native return and repository selection are still unverified. The post-publication browser inspection failed twice with `Debugger unattached`; native accessibility element IDs also became stale. Valid client credentials alone do not establish a connected user account.

## 14 September: native form origin failure resolved

The user's error text identified the completion POST's origin guard. A real Chromium/WebKit reproduction showed that `Referrer-Policy: no-referrer` produces `Origin: null` for the auto-submitted HTML form. The guard was correctly rejecting this. Changed the document policy to `same-origin`, preserving cross-origin referrer suppression and retaining the strict origin/authentication/one-use ticket checks. Null and foreign origins remain rejected.

Four route tests pass. The new `scripts/verify-github-handoff-form.cjs` serves the actual deployed document with its security headers in isolated browser fixtures, captures submission without consuming a real ticket, and checks its origin. It failed against the previous release with `Origin: null`; Chromium and WebKit both pass against `.next-ui-release-1789389989419-pre-effects`. Production build passed; release published after a fresh idle/cleanup gate.

Live native UI now displays Manage GitHub connection and Add repositories. The user's selected `cettocdx/viral-places` appears in Projects with a running user-initiated conversation. This verifies connected native state and project visibility; completion of that repository task is not yet established. No production-domain environment update or deployment is claimed.
