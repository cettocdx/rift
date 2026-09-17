# Main-route keyboard continuity — 13 September 2026

## Reproduced defects

Artifacts and Tasks used controlled Radix dialogs without DialogTrigger-based return targets. Dismissing their dialogs left focus on the document instead of the control that opened them.

The installed RIFT UI Preview, served from the production build of `f4622d7` at port 3020, reproduced both problems: opening an artifact and pressing Escape did not return focus to the card; opening Create task and clicking Cancel left the accessibility focus on the HTML document. No task was submitted or modified in these native checks.

## Changes

- Artifact previews remember the initiating card and restore focus without scrolling on Escape or Close. When a live library update removes the card, the active filter is the fallback.
- Task creation returns to Create task. Editing returns to the task row's actions button. If saving or a live update removes/disables that button, Create task is the fallback.
- Existing download, task scheduling, execution, filtering, and persistence behavior is unchanged.

## Verification

Real-component Jest regressions failed before the fixes: three artifact cases and three task cases. The task coverage also includes removal of the edited row during the open dialog. The artifact coverage checks that the next Tab reaches the following card. Radix Dialog is not mocked in these tests.

Focused verification: 23 artifact tests and 22 task tests passed. The final browser matrix passed 10 cases with two intentional mobile-only exclusions on desktop (`/tmp/rift-route-focus-browser-final.log`). Browser fixtures import the production components and styles with synthetic local data and mocked backend services. They exercise dismissal and subsequent keyboard traversal in Chromium and WebKit, on desktop and touch-enabled 360px viewports. WebKit uses its Option-Tab convention to navigate all controls. Separate 360×320 cases check that Close/Cancel remain reachable and draft entry does not write a task. These short layout viewports do not prove physical mobile keyboard or visualViewport behavior.

## Native route review and limits

The installed desktop app opened Agents profiles, Plugins, Runs, Artifacts, Tasks, Studio, and Hack Workbench. Studio scrolling reached its model and editable-brief sections. This was a navigation/layout review, not a latency benchmark or a full functional acceptance run. External plugins showing Reconnect were not counted as working integrations. Saved security requests were only viewed, never executed.

The broader workspace fixture matrix also passed 48 cases with four intentional viewport exclusions, covering Runs, Tasks, Agents, and Appearance in both themes (`/tmp/rift-main-route-browser-suite.log`).

Hack Workbench displayed an interim-sounding saved message under its final Response label. Read-only persisted metadata confirmed `finish_reason: timeout` on both the chat and its run, with run status `completed_with_warnings`. The separate completion-state fix is documented in `2026-09-13-hack-cutoff-presentation.md`.

GitHub remains independently blocked by account re-verification for the replacement OAuth credentials. Landing redesign, production-worker rollout, physical-device tests, and broader endurance/performance acceptance are outside this change and remain open.

## Deployed check

Commit `11a4346` passed the full pre-commit gate: 750 suites, 7,460 tests passed, one skipped, 24 snapshots, TypeScript, lint, and packaged CLI integrity. Its production build succeeded and the optional Convex message projection deployed to the existing Preview backend. Immediately before the web-only restart, all 279 claims were released.

The installed app then returned focus to the originating artifact after both Escape and Close, to Create task after Escape, and to the saved task's actions after Edit → Cancel. No task edits were saved. Subsequent-card traversal is proven by the browser fixtures; native key-preference behavior is not claimed equivalent to those fixtures.
