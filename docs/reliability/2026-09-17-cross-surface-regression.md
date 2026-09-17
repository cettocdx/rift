# Cross-surface regression — 2026-09-17

## Web/backend regression

Full Jest run: 812 suites; 808 passed and four failed. 8,280 tests passed, 17 failed, one skipped; 24 snapshots passed. Log: `/tmp/rift-full-regression-0917.log` (377.787 seconds).

All four failures were reviewed against the current implementation:

- Upload policy mocks omitted Convex `v.array`, introduced by upload entitlements. Added the missing mock; production validation was not loosened.
- A prompt test expected removed wording. It now verifies the current local-host warning, non-destructive verification, exclusion of credential theft/persistence/disruption/unrequested access, and no repetitive authorization questions.
- Report branding and coverage tests still searched the old monolithic component after report rendering moved into `report-html.ts`. They now exercise actual rendered HTML for embedded canonical artwork, scope-before-findings ordering, and a non-clean result when no checks ran. Existing Stop routing assertions remain.

Reran all four affected suites: 76/76 tests passed. Combined with the unchanged passing suites, all 812 suites are verified after these test-only corrections; 8,297 tests pass, one remains skipped. This is a full run plus focused rechecks, not a claim that the initial full command returned zero. Scoped ESLint and whitespace checks passed. No runtime source changed in this pass.

## Terminal browser tests

- Chromium desktop/mobile, light/dark: four cases passed.
- WebKit initially could not launch because the expected executable was missing. Installed the lockfile-matched WebKit runtime and reran those four cases: all passed.
- Each case rendered 13,056,014 bytes, acknowledged 640 output frames, retained one terminal session without detaching during panel hide/resize, kept the chat draft, accepted typing and Ctrl+C, and preserved the final UTF-8 marker within bounded scrollback.
- Logs: `/tmp/rift-terminal-acceptance-0917.log`, `/tmp/rift-terminal-webkit-0917.log`.
- WebKit frame intervals: p95 18–19 ms, p99 18–36 ms, maximum 18–126 ms. Other test/build processes were active; these are diagnostic observations, not an isolated latency baseline or a zero-jank pass. No native PTY/server execution was exercised by the mocked transport fixture.
- Inspected the rendered mobile light terminal: theme is consistent and final output is visible.

## Transcript/browser acceptance

72 cases passed, 16 configuration-specific skips across Chromium/WebKit and widths 360, 390, 430, and desktop. Scenarios include semantic reading anchors, keyboard-sized resize, image insertion, streamed code, Markdown completion, away/back restoration, and desktop dock transitions under continued output.

The skips are deliberate cross-project exclusions: desktop dock integration in mobile projects (12), and mobile-only zero-height question dock in desktop projects (4). They are not counted as passes. Log: `/tmp/rift-transcript-acceptance-0917.log`; report: `e2e/mobile-fixture/results/transcript/report.json`.

## Native iOS

The registered RIFT iPhone simulator could not boot: its data directory was absent. Did not erase or delete either existing device. Created independent `RIFT Acceptance 0917` (DD5A7DA3-1118-482C-9D3C-2BE17DC7FF05), iPhone 17 / iOS 26.5.

- Signed simulator build and 49 native unit tests passed. Includes stream reduction, history/activity, model catalog, questions, files and session persistence. Log: `/tmp/rift-native-unit-fresh-0917.log`.
- Two XCUITests passed: three rounds of Studio/Hack/Build navigation with task-draft insertion; Studio template sheet and draft preparation without sending. Log: `/tmp/rift-native-navigation-0917.log`.
- Exported and visually inspected gallery and template-detail screenshots from xcresult. OLED background, equal card geometry, and visible sheet actions verified in that device/size. Attachments: `/tmp/rift-native-navigation-attachments-0917/`.
- Fresh simulator is signed out and no provider task was sent. These are not authenticated live acceptance, physical-device tests, or iOS 27 runtime validation. No TestFlight upload occurred.

## Outstanding release blockers

Provider funding prevented the earlier live test, but a subsequent read-only balance check confirmed available funding. The live Hack detach test then exposed missing Redis configuration; after configuring an authenticated local service, the isolated preview passed the detach/reconnect test. See `2026-09-17-http-resumption-runtime.md` for exact evidence and rollout limits. Sub-four-second startup, production durable Hack rollout, multi-hour native-origin recovery, historical cleanup proof, macOS screen/input permissions, authenticated physical-device acceptance, and comparable performance benchmarks remain open. The main web/native user processes were not restarted by this pass.
