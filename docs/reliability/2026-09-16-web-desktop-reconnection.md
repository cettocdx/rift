# Web and desktop reconnection — 2026-09-16

The user prioritized web and desktop over iOS. Native changes remain separate and were not uploaded to TestFlight in this pass.

## Reproduced defect and change

`useAutoResume` allowed one automatic recovery per local send. If that attachment also failed, recovery stopped until another visibility/online event or manual action. A new regression reproduced one GET instead of the expected second GET.

Transient reconnect failures now schedule another attachment with exponential delay (1 second, 2 seconds, capped at 30 seconds). Only the existing stream is attached; no user POST is resubmitted. Offline/hidden readers wait for return. Explicit stop, new submission, completed/absent producer, and unmount suppress scheduled attempts. Completed-turn late-persistence replay regression still passes.

Validation:

- 133 tests passed across nine suites: recovery, replay, retained continuation, dispatch, resume ownership and delegate execution/receipts.
- TypeScript, scoped ESLint and diff whitespace checks passed.
- Production preview build passed: `.next-ui-release-1789587828191-575b475c`.
- New build served at localhost:3022. Browser verified the saved continuity-test transcript and one final response.

## Live worker evidence

Run `run_06ganfrr3c9a8cqt0odbs80j01`, chat `551c5fc5-d8f2-46c6-a88e-fec57dc9e7f0`, development worker `20260915.13`:

- Completed while observer was detached.
- One command, one matching result, exit 0, all 12 markers.
- Command duration 123527 ms; total observation 149469 ms.
- Zero duplicate observed events; cleanup confirmed.
- First text 14824 ms: startup speed remains below the desired quality target.

Evidence: `/tmp/rift-web-worker-reconnect-0916.json`, `/tmp/rift-web-desktop-resilience-0916.log`, `/tmp/rift-web-recovery-build.log`.

This is a two-minute command/transport test, not a multi-hour desktop UI acceptance test or proof against provider outages.

## Deployment limitation and outstanding work

Desktop still points to localhost:3020. Restart gate found seven historical unreleased claims whose Trigger runs are terminal (completed/canceled/crashed/failed). Authenticated normal resume returned 204 for each but did not release their cleanup gates. No claims were deleted or forcibly released. 3020 and its worker were not restarted. New code is available on 3022, not yet adopted by the open desktop window.

Artificial per-delegate token/time/step limits were already removed in the current source; provider constraints and the parent worker lifecycle still apply. The 58-minute elapsed budget and 60-minute task timeout have now been removed: durable tasks use Trigger SDK `timeout.None` and the stream runner receives an infinite elapsed budget. Explicit cancellation, budget accounting, ownership fencing and loop protection remain. The legacy OpenCode driver does not arm a JavaScript timeout for an infinite budget (Node otherwise overflows it into an immediate timer). Multi-hour acceptance, historical cleanup reconciliation, desktop deployment, and production environment parity remain open. Do not describe all interruptions as solved.

## Cleanup recovery and unlimited durable execution

Remote receipt verification could reject before integration clients closed and before `cleanupDrained` was recorded. `settleExecutionDrain` now joins local callbacks, closes integrations, records local drain proof, then waits for remote settlement. Remote failure still rejects and never certifies task success or remote exit. Failed local cleanup does not record drain proof.

When GET resume observes a terminal run but claim release is blocked by missing cleanup, it schedules owned receipt reconciliation with Next `after`. This does not bypass ownership checks or force-release historical claims.

Targeted cleanup/resume tests: 33 passed. Unlimited-timer and stop-condition tests: 31 passed. These do not substitute for hour-long production acceptance. Build `.next-ui-release-1789589133380-9fbf991e` passed with cleanup changes; 3022 adopted that build after its live check ended and returned HTTP 200.

Initial full Jest run: 804 suites passed, one import-order contract failed; fixed by preserving worker-module-timing as the first import. The targeted contract passed. Final full regression passed: **806 suites, 8216 tests, 24 snapshots; one skipped test** (285.02 seconds). TypeScript and scoped ESLint also passed.

## New-worker live validation

Run `run_06ganm2lqrjk5v51kr654bh801`, chat `9be470d6-40ff-4006-a5b3-12342b1b0510`, worker `20260916.3`: completed while detached, exactly one command and one result, 12/12 markers, exit 0, zero duplicate events, cleanup confirmed. Command duration 123654 ms; total 146568 ms. First text 13083 ms: this remains a latency failure against the requested target, not a performance acceptance pass. Evidence: `/tmp/rift-worker-final-0916.json`.

Final regression log: `/tmp/rift-full-regression-final-0916.log`. Browser transcript fixture results are separate from actual desktop-shell and provider acceptance.

## Browser transcript verification

Chromium desktop: 9 passed, 2 mobile-only cases skipped. WebKit desktop: 9 passed, 2 mobile-only cases skipped. Tests exercised streamed text/code, image insertion, panel reflow, semantic reading anchors and away/back restoration. WebKit initially could not launch because its Playwright executable was missing; installed the matching browser and reran successfully. These are isolated component/workspace fixtures, not proof of native app closure or multi-hour production execution.

Logs: `/tmp/rift-desktop-transcript-0916.log` (Chromium pass and initial missing-WebKit error), `/tmp/rift-webkit-transcript-0916.log` (successful WebKit rerun).

Final production build passed: `.next-ui-release-1789589840945-9f8b0c84`, adopted on port 3022. Desktop port 3020 remains unchanged: gate still reports seven historical unreleased claims (384 total, 377 released). No forced release or cancellation was performed.

## Follow-up acceptance (same day)

- Added a separate read-only web-maintenance gate. It verifies complete claim inventory and exact provider ownership, blocks active/unknown producers and pending admissions, and allows only the Next web process to restart after every producer is terminal. It never releases claims or authorizes worker shutdown. Nine gate tests pass.
- Moved Hack task registration to `trigger/hack-long.ts`, preserving the shared factory and server-owned purpose selection. The agent-only canary no longer registers Hack as an import side effect. Static graph inspection now resolves literal calls to local named registration factories; unknown IDs and transitive scheduled tasks still fail closed. Canary config tests 7/7; wiring/timing/contracts 61/61.
- Fixed the offline soak success fixture to supply actual cleanup confirmation and added a negative case: successful command output without cleanup proof must fail acceptance. All 105 Node helper-script tests pass.
- Live cancellation run `run_06gantno8sauj4m6q09mnk6s01`: own test command input observed, cancellation HTTP 200/canceled true, completion and cleanupDrained/cleanupConfirmed true in 5710ms. This is cancellation success, not task success. Evidence `/tmp/rift-cancel-live-result.json`.
- Mac worker LaunchAgent explicitly overrides `RIFT_WORKER_PROCESS_REUSE=false`, despite the source default being enabled. No forced worker restart or unverified reuse enablement performed. Existing deployment-isolation acceptance remains incomplete.
- Mixed live measurements (single sample each): greeting 11871ms; explanation 9561ms; terminal first reasoning 32685ms / first text 49277ms. All completed with verified scenario output and no duplicates. These are exploratory, not percentile/SLO evidence. `/tmp/rift-mixed-current.json`.
- Codex CLI 0.154.0 ran the same tool-free explanation with medium effort and GPT-6 Astra: final message event 9273ms, process completion 10195ms. CLI emitted no first-token event, so this is not directly comparable to RIFT first-text latency. Cursor AX inspection timed out twice; Claude CLI symlink points to a missing executable. No three-product performance parity claim is justified.
- Staging dry build succeeded but reported skill discovery failure; no staging deployment or production promotion performed.

## Final follow-up outcomes

Twenty-minute terminal run `run_06ganqo4er631h0ld1bo3mnn01` completed while its observer was detached. One command, one result, all 120 markers, exit 0; command 1204129ms, total 1235748ms; zero duplicate events; remote cleanup confirmed. Desktop was quit and reopened during this independently dispatched run, and provider status remained EXECUTING while the desktop was closed. This does not establish multi-hour behavior or native-origin stream reattachment by itself. Evidence `/tmp/rift-long-disconnect-0920.json`.

Final source verification: 806 Jest suites / 8216 tests / 24 snapshots passed (one skipped); 105 Node script tests passed; TypeScript, scoped ESLint and whitespace checks passed. Production build `.next-ui-release-1789591851615-39f6ca00` passed.

At web maintenance, 389 claims were inventoried: seven terminal historical producers, no active producers, no pending admissions. The web-only gate passed. Only `app.riftsys.ui-preview-web` was restarted; no worker service or remote sandbox was terminated. Port 3020 returned 200, desktop was reloaded, and native AX verified the signed-in Build screen. Latest web fixes are now adopted by the desktop. Historical claims were not force-released.

Still open: seven historical claims lack complete local drain proof (some have pending remote receipts; one predates journaling); under-four-second startup; isolated multi-user runtime reuse acceptance; multi-hour native-origin close/reopen acceptance; comparable Cursor/Claude/Codex measurements. Do not claim parity or zero-failure operation. The earlier desktop-unadopted status in this report is superseded by this section.
