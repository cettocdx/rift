# Hack mobile keyboard and transcript space

Hack Workbench was a separate fixed `100dvh` shell and did not observe the visual viewport. The shared Build fix therefore did not protect Hack from the iOS keyboard displacing its header and composer.

The workbench now attaches the existing measured viewport observer to its root and uses the shared viewport CSS. This changes only presentation geometry; it does not recreate the retained chat, restart an assessment, alter its execution target, or dispatch a request.

On coarse-pointer phones, while the keyboard reduces the viewport and the command field has focus, the overview and duplicate bottom task shortcuts are hidden. The titlebar task switch remains usable. Both sections return on blur, leaving more vertical space for the transcript while typing.

## Verification

- New workbench integration regression failed before the observer was attached. It exercises Safari's observed 377px visual height, 714px layout height and 337px offset while retaining the assessment draft.
- Workbench lifecycle plus viewport suites: **69 passed**.
- Production Hack component browser fixture: **6 passed** across Chromium/WebKit at 360, 390 and 430px. It checks command bounds/font floor, task sidebar round trip, draft retention, keyboard-time compact chrome, restored overview and transcript space. Backend boundaries deliberately throw on attempted execution; no assessment is sent.
- Real iOS 26.5 Safari simulator: `MobileHackWebKeyboardTests/testSafariHackKeyboardAndTasks` passed with one executed test, preserving the command through keyboard/task sidebar interaction. Measured shell y=0, height=377, scale=1. `/tmp/rift-hack-safari-fresh-runner.xcresult` retains the keyboard screenshot. An initial Xcode invocation incorrectly reused an old installed UI test runner and ran zero cases; it is not counted. Only the dedicated simulator's test runner was reinstalled, then one test actually ran.
- Studio model/route states, video persistence and durable image download: **44 tests passed** (`/tmp/rift-studio-acceptance-unit.log`). This is component/unit coverage, not a live paid generation or native iOS acceptance.
- Full TypeScript and scoped ESLint passed before the final CSS-only compaction; final production build validates the combined release.

## Reproduction

```sh
pnpm exec playwright test -c e2e/mobile-fixture/playwright.hack.config.ts --workers=2
RIFT_FIXTURE_PORT=3061 RIFT_HACK_FIXTURE=1 node e2e/mobile-fixture/server.cjs
```

For the Safari case, open `http://127.0.0.1:3061/lab/composer?viewportDiagnostics=1` in the dedicated simulator's Safari, then run the opt-in `MobileHackWebKeyboardTests` with `TEST_RUNNER_RIFT_MOBILE_WEB_FIXTURE=1`. Assert the Xcode result executes one test, not merely exit zero.

## Remaining boundary

The fixture deliberately uses synthetic completed report text with the production workbench. It does not prove live Hack worker continuity. Main web and worker have not been restarted; public rollout and end-to-end long-task acceptance remain outstanding.

## Final artifact and runtime separation

- Combined production build completed successfully: `.next-ui-release-1789606516215-e9d14df3` (`/tmp/rift-hack-mobile-final-release.log`). Full TypeScript and scoped lint exited zero.
- Final compact Safari test executed one case and passed in 13.397 seconds: `/tmp/rift-hack-safari-compact.xcresult`. Its keyboard screenshot was visually inspected; the command stays above the keyboard and the transcript retains space. The white viewport diagnostics strip belongs only to the test fixture.
- This artifact is served separately at `http://localhost:3063`; the root returned HTTP 200. This replaces neither the main web process nor its worker. Port 3060 remains an older artifact.
- Read-only producer inspection at 2026-09-17T00:57:15Z found one ownership-matched Trigger run still EXECUTING, another unresolved 404, seven terminal runs with unreleased claims, and one HTTP execution still recorded as running. These are not sufficient grounds to terminate work or blindly release claims. Runtime reconciliation and a safe worker rollout remain required before claiming these backend fixes are live.
