# Live navigation acceptance and approval visibility

## Real session, real worker

On the independently served release at localhost:3064, an authenticated account submitted a new Cloud Build task through the normal composer. The task was limited to one Python command printing `RIFT_QA_NAV_START`, waiting 20 seconds, and printing `RIFT_QA_NAV_DONE`. It did not read/edit a project or delegate.

Chat: `1355dcbc-b50c-4c6a-9eb3-4b55d50b6e21`. Trigger run: `run_06gapv647tejc89rj428shef01`.

The browser switched to Studio after dispatch, changed to a 390 × 844 mobile viewport, returned via the mobile navigation, opened Activity and terminal detail, approved only that command, switched to Studio again during execution, then performed a full navigation back to the same chat. The final answer remained visible after reloading.

The owner-scoped persisted-message query returned exactly one assistant message and one `tool-run_terminal_cmd` invocation (`call_wt2954rgzylYAev9vf8hcJa0`). Its result contained the two expected output lines, exit code 0 and duration 24,269 ms. The complete page was returned (`isDone: true`). Evidence: `/tmp/rift-navigation-persisted-result.json`.

The displayed total duration was 136 seconds, including the intentional approval wait. This is not a 136-second command or a first-response benchmark. Worker telemetry recorded first model text at 8,984 ms, so the first-response target is not yet met. This single task proves this navigation/reload path, not arbitrary long-task reliability or native iOS behavior.

## Newly reproduced defect

While the command awaited approval, the transcript correctly displayed the review card and “This action has not run.” However, Activity said “Executing” and “Running command,” and its terminal detail said “Executing command.” This falsely implied progress and hid the reason for waiting when the mobile full-screen panel covered the chat.

## Correction

- The authenticated pending-approval query includes the exact tool invocation ID, retaining its existing account/chat query boundary.
- A chat-scoped context supplies those IDs and a return-to-review action to both mobile Computer and desktop workbench Activity/detail panels.
- Only matching displayed invocations are labelled “Awaiting approval.” They are excluded from running operation counts; other invocations and historical turns retain their own states.
- The Activity panel explains that the pending action has not run. “Review in chat” closes the panel and brings the existing approval card into view; it does not grant permission.
- Terminal detail does not render a running command/output placeholder for a pending action. No execution/retry/billing policy was changed.

## Validation

Before the fix the two new behavioral tests failed (17 existing tests passed). After implementation the focused suite passed 19 tests; the broader Activity, workbench, approval card and database approval suite passed 78 tests. Logs: `/tmp/rift-activity-approval-red.log`, `/tmp/rift-activity-approval-green.log`, `/tmp/rift-activity-approval-regression.log`.

The first full type check identified a missing invocation ID in the no-action approval lab fixture; that fixture was corrected. The production build then exited zero, including TypeScript (86 seconds) and 145 static pages. Artifact: `.next-ui-release-1789609201283-4b82c362`, served independently at localhost:3065. Log: `/tmp/rift-activity-approval-release.log`. Scoped ESLint and diff whitespace checks passed.

The additive pending-query change was pushed to the actual serving Convex backend at 04:43:02 local time with full database type checking enabled; deploy exited zero (`/tmp/rift-activity-approval-backend-deploy.log`). This did not switch backend environments or restart the main web/worker.

The navigation canary's Trigger run subsequently reported COMPLETED and `cleanupDrained: true` (updated 01:33:02 UTC). The completed mobile Activity panel displayed “Executed” without a running indicator. The mobile navigation was also checked in light theme: the New chat action used the neutral foreground color and the header had no black skip-link shadow. Theme preference was restored afterward.

Main web/worker maintenance is still separate: one legacy claim cannot be observed (provider 404), older producer claims lack cleanup-drain proof, and one HTTP execution remains recorded running. None was forcibly released or restarted for this acceptance test.

## Post-deployment live approval acceptance

On release 3065, at 390 × 844, the signed-in account submitted one harmless Cloud command, `echo RIFT_QA_APPROVAL_OK`, using Review first. Chat: `3b3195e3-8340-4e67-9c4c-ad483b356816`.

Before approval, Activity showed “Awaiting approval,” “Waiting for approval,” and the explicit not-run banner. Opening the operation showed the same not-run state in terminal detail. “Review in chat” closed the full-screen panel and returned to the actual approval card. The test approved that single command with Allow once. The final answer showed `RIFT_QA_APPROVAL_OK` and exit status 0. Reopening Activity showed “Agent ready” and “Executed,” with no stale approval banner or running indicator. The displayed 203-second total includes deliberate manual inspection/approval waiting; it is not a command-duration or first-token benchmark.

The final regression run passed all 78 tests in five suites (`/tmp/rift-activity-approval-final.log`). A separate user task was active during verification; it was not interrupted for rollout.
