# Local selection and automatic desktop capabilities

The current account had two command runners with the same display name. The older registration was still marked connected but had not refreshed for over six days. GlobalState selected the first database row as the default. The current receiver passed an authenticated HybridSandboxManager command: `printf RIFT_LOCAL_OK`, exit 0. The stale record must not be treated as an available default.

The UI now filters expired runner registrations and sorts fresh command receivers by lastSeen. The freshness window is 65 minutes because relay JWTs last one hour. This is a presentation filter, not proof of liveness: admission still probes the selected receiver. Existing chat target IDs are not silently moved to another computer or Cloud.

Native owner synchronization now enables local websites and computer control for the signed-in account without a separate application toggle. Sign-out/account switching still invalidates previous grants and queued operations. macOS Screen Recording and Accessibility are independent; a screenshot request invokes the OS screen permission request when needed. The settings component shows readiness and OS permission links instead of connection switches.

Verification:

- 37 focused UI/selection/ownership tests passed.
- 10 GlobalState lifecycle/context tests passed.
- 12 conversation access-card tests passed.
- 4 native computer access tests passed, including default activation and revocation fences.
- TypeScript and scoped lint passed; native and web builds succeeded.
- Updated `/Applications/RIFT UI Preview.app` executable and verified its ad-hoc signature. Previous executable: `/tmp/rift-desktop-before-local-defaults-20260917`.
- Live native relay after restart: localWeb=true, computer=true, screenRecording=false, accessibility=false.
- Authenticated native loopback fetch of `http://localhost:3054/robots.txt`: HTTP 200, 312 bytes, not truncated.
- Successfully read relay presence for the six-day-old registration: no matching receiver was online. Rechecked its owner and age, then marked only that stale registration disconnected through the supported backend mutation. The current runner was not restarted. This also removes the bad default from the existing 3020 connection list without restarting its web process.

The main 3020 web process was not restarted: its maintenance gate found one active worker and one HTTP execution still marked running. The new web release is previewed separately on 3054. The installed native defaults are active; the new settings presentation/runner filtering require the updated web release. OS screen/input permission is not granted by these source changes and full mouse/keyboard control was not tested.

Follow-up: the current isolated preview is now 3057; see `2026-09-17-http-resumption-runtime.md`. Local admission and persisted failure copy no longer direct users to removed connection switches or suggest changing their chosen execution target. They explain opening Desktop on the selected computer and signing in with the same account for automatic reconnection. The three failure-description tests and scoped lint passed. This follow-up is included in the production-built 3057 preview (`.next-ui-release-1789602136608-0dcc5e76`). The main 3020 process remains on its previous release.

## Current maintenance check

The latest read-only inventory still prevents a main-web restart: two active claim run IDs returned 404 from the configured Trigger environment, and one HTTP execution remains marked running. A 404 is not evidence of producer termination. No claim was released and no user task was stopped. Diagnostic inventory: `/tmp/rift-maintenance-inventory-current.json`.

Fresh authenticated verification through the current `HybridSandboxManager` succeeded: one fresh command receiver, `printf RIFT_LOCAL_CURRENT_OK`, exit code 0, exact output match. This exercised the normal receiver selection and command transport, with no Cloud fallback. Diagnostic: `/tmp/rift-current-local-check.log`. Screen/input actions were not exercised by this command probe.
