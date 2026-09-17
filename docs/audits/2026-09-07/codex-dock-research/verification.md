# Dock verification

Verified on September 7, 2026 in `codex/reference-ui-rebuild`, using the local RIFT UI Preview macOS app and localhost:3020. The production RIFT application was not replaced or deployed.

## Observed in the running native app

The browser loaded the local `/lab/browser` fixture in a native child webview. A typed `RIFT retained` value survived switching to Activity and Terminal, hiding and reopening the dock, maximizing and restoring, and moving between right and bottom placement. Following the fixture link updated the address to page 2; Back restored page 1 and its input value; Forward returned to page 2. These checks used actual UI input, not simulated browser snapshots.

Reloading the main RIFT window removed the old child browser view and returned to the conversation UI without an orphaned page covering it. The terminal rendered in the shared dock, but no new workspace grant or real PTY was created for this verification. Terminal DOM/session continuity was covered by component tests.

In the saved **Build Harness Smoke Test** conversation, the Edited files card's Review action opened the actual `rift-working-file-smoke.md` diff, including the one-line `before` to `after` change. The dock's Review tab listed all three files represented by that conversation's tool results. No model request or file mutation was made by these checks.

The Files tab opened in that existing conversation and loaded the actual runtime folders `rift-harness-smoke-20260907-2007` and `upload`, with its search and refresh controls visible. This confirms the old home-only CSS no longer hides Files in an active conversation; it does not imply arbitrary PC file access.

The window's browser/terminal/panel buttons were initially covered by the right dock. Native geometry inspection found the running server still serving the old global inset rule. The workbench-specific right inset was scoped to the workspace stylesheet. After resizing, the measured pane width and titlebar right inset both equaled approximately 467.3 CSS pixels, and the three controls were visibly aligned at the conversation edge. Temporary measurement instrumentation was removed. The callback-ref observer also handles late panel mounts and replacements.

## Automated checks

- The combined focused JavaScript run passed 148 tests across 12 suites. This includes overlapping subsets reported during implementation; those subset counts must not be added to this total.
- The native browser and lifecycle suite passed 30 tests; the macOS preview build completed successfully.
- TypeScript `tsc --noEmit` exited 0. Scoped ESLint, formatting and diff whitespace checks passed.
- A later address-input regression fix passed all 11 WorkbenchBrowser tests, including repeated URL entry and correcting an invalid address while retaining focus.
- The final follow-up integration run passed 60 tests across 5 suites; 8 separate titlebar geometry tests passed. These overlap earlier suites and are not added to the original total. TypeScript also exited 0 in the follow-up check.
- The permission trigger now stays on one line and hides only its label in a narrow composer, retaining its accessible name. Its 3 related suites passed 17 tests; the final narrow-width appearance was not separately rechecked in the native app after that small adjustment.

Logs for this development session are under `/tmp/rift-dock-final-tests.log`, `/tmp/rift-dock-final-typecheck.log`, `/tmp/rift-dock-lint-final.log`, `/tmp/rift-dock-final-format.log`, `/tmp/rift-native-browser-lifecycle-after.log` and `/tmp/rift-native-dock-build.log`. They are local temporary logs, not permanent CI evidence.

## Scope limits

- Live Codex inspection was denied by the computer-use tool. No attempt was made to route the denied inspection through Claude or another application. Visual targets came from the supplied recording/screenshots; documented behavior came from official sources in the source report.
- The native browser implementation is macOS-specific and uses isolated, temporary browser state. Extensions, saved-password management, downloads and agent control of the visible browser are not implemented here.
- The web version uses a sandboxed iframe with explicit limitations; sites that prohibit embedding require opening externally. Native history and external-site authentication are not claimed for that fallback.
- Files reuses RIFT's file preview rather than implementing a complete editable IDE. Review shows conversation changes rather than a full Git working-tree review. Sidechat is not implemented.
- No paid model run, OAuth connection or production deployment was performed for this dock change. The native UI checks do not constitute a new harness capability benchmark.
