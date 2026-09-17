# Sandbox readiness: actionable failures and safe retries

## Finding

The terminal readiness probe retried missing/expired workspaces and full disks, although unchanged retries cannot resolve these conditions. The terminal tool also marked every readiness failure as `retryable: true`, including authentication and configuration failures. This could encourage repeated tool calls without advancing a task.

## Change

- Share the SDK error classification between readiness backoff and the terminal result. Authentication, invalid configuration/template, missing/expired workspace, full disk and failed probe commands do not trigger unchanged retries.
- Preserve bounded retries for transient connectivity failures, ordinary request timeouts and rate limits.
- Report a requested command blocked by readiness as `outcome: not_started`, `exitCode: null`; do not claim the user command ran and exited unsuccessfully.
- Preserve the existing workspace. Do not delete it, silently replace it, or replay commands with uncertain outcomes.
- Remove stale messages promising automatic workspace replacement or advising deletion of the sandbox.

## Verification

Nine new cases failed before the implementation: six terminal result classifications and three readiness backoff cases. An additional unavailable-workspace test covers the not-started result. The three focused suites pass 65 tests, including cancellation and transient recovery. Four related sandbox manager/preparation suites pass another 23 tests (88 total). Full TypeScript, scoped ESLint and `git diff --check` pass.

Evidence: `/tmp/rift-readiness-classification-red.log`, `/tmp/rift-readiness-classification-green.log`, `/tmp/rift-readiness-classification-lint.log`, `/tmp/rift-readiness-classification-typecheck.log`.

## Scope

This prevents incorrect retry advice and unnecessary readiness backoff. It does not restore an expired workspace, fix provider credentials, or establish that every historic mobile failure shared this cause.

## Deployment and rendered acceptance

- Release build passed: `.next-ui-release-1789622329697-b58b73c3`, separately served on port 3080. Main 3020/3057 and existing desktop bundle were not restarted.
- The release's real public `/login` and `/signup` routes passed 12 Chromium/WebKit cases at 360, 390 and 430 CSS pixels. Screenshot review confirmed the 390px WebKit login layout. This is browser emulation, not a real soft-keyboard test.
- In the authenticated in-app browser on the new release, existing chat `c5912f7c-2cf5-462f-842d-ca2afaf08ce1` loaded its Activity detail, returned to the activity list, displayed all three completed collaborators and a completed 6/6 plan. A temporary unsent draft survived closing Activity, opening Preview, switching back to Activity and closing the panel. The test draft was then cleared; no message was submitted.
- Preview health reported running, but the embedded content remained subject to the previously reproduced in-app-browser limitation. This check does not establish a successful rendered preview.
- Hosted staging version `20260917.6`, deployment `deployment_xi6ujtpn4zu2p7fre4fyy`, verified `DEPLOYED` on `linux/amd64`, content hash `725097fa62306fbe5339bc8fc4c9dcee`. Exactly `agent-long` and `hack-long`, zero schedules. Deployed without promotion. Isolated API snapshot on 3078 synchronized and pinned to that exact version; ordinary QA account verification remains pending.

Receipts: `/tmp/rift-mobile-release-0917-build.log`, `/tmp/rift-mobile-release-0917-public.log`, `e2e/mobile-public/results/report.json`, `/tmp/rift-classification-hosted-manifest.json`. Production readiness and live hosted long-task recovery are still unproven.
