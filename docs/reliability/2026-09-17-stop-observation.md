# Observe termination after Stop

## Defects reproduced

`cancelRunAndConfirm` returned after an accepted cancellation without reading the resulting run state. It also accepted a 404 after a failed cancellation as terminal proof. Both paths could close the run record while termination was unverified. A racing COMPLETED or FAILED run could be recorded as user-cancelled.

## Behavior

The helper now sends one cancellation and observes the same run. Only an explicit terminal status allows it to return. Active runs are polled briefly; individual provider calls and the observation period are bounded. A lookup failure or an unconfirmed deadline throws so callers preserve the existing mapping/claim. Cancellation is never inferred from a 404.

The run record is labelled cancelled only for CANCELED. Completion/failure outcomes are left to their existing authoritative recorder. The cooperative path returns immediately on an already-terminal run without force-cancelling it.

This confirms producer termination only. Existing remote-resource cleanup receipts still gate claim release; worker exit does not establish remote process exit.

## Verification

- Eight new behavioral regressions failed against the old code, with 13 existing tests passing (`/tmp/rift-stop-confirm-red.log`).
- Seven suites passed after the change: 205 tests covering cancellation helpers/routes, startup failure cleanup, claim admission and Hack cancel contracts (`/tmp/rift-stop-confirm-final.log`).
- Route fixtures now provide an actual post-cancel status observation. The old fixture model returned acceptance alone and could not detect the bug.
- Replaced two source-string assertions with behavioral helper coverage. Previous string checks described confirmation but did not execute the acknowledgement race.
- No real user task was cancelled for these tests.
- Scoped ESLint and `git diff --check` passed. The combined production build, including the earlier reconnect-404 fix, exited zero: `.next-ui-release-1789607410067-6c293193` (`/tmp/rift-recovery-stop-release.log`). Full TypeScript and all 145 static pages completed. This artifact has not replaced the running 3063 preview or the main worker.

## Outstanding

Production rollout and live long-task/Stop acceptance are still required. Main web and Trigger worker were left running because the previously identified producer still reported EXECUTING. Unresolved legacy cleanup claims require independent reconciliation.
