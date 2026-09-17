# Long cleanup follow-up — completed

The same run completed on worker `20260915.11`. Command duration 1,204,464 ms,
120 ordered markers, command count 1, result count 1, exit 0, no duplicate
events. Observer detached and recovered after completion. Fresh provider
metadata confirmed cleanup; an independent owner-scoped Convex query matched
the same run and returned claim phase `released`. Evidence:
`2026-09-15-long-cleanup-verified.json` and
`2026-09-15-long-cleanup-lifecycle.json`.

This establishes one 20-minute command/observer-disconnection lifecycle, not
worker process death or all long workloads. Do not restart the completed probe.

## Original execution record

A new 20-minute, single-command continuity run is executing on worker
`20260915.11`: `run_06ga8dmlvucr4runk0ncl7nj01`, chat
`7025c47e-3d10-4757-8278-79c7dc8c2c82`.

Observer process session: 35092. Output `/tmp/rift-long-cleanup-verified.json`,
log `/tmp/rift-long-cleanup-verified.log`. The provider was queried and reported
EXECUTING after admission. Do not restart on an observation timeout. Inspect
this same run and observer handle until authoritative terminal state arrives.

Acceptance requires exact command once, all 120 ordered markers, confirmed
exit 0 after at least 20 minutes, detached observer recovery, no duplicated
events, explicit cleanup confirmation, and a matching released database claim.
The updated probe enforces cleanup proof, but the independent database claim
read still needs to be done after completion.

Commit `95f4a9f` contains the exit-read retry, its regression tests and the
short live verification. 67 Jest tests and 12 Node tests passed. Targeted
ESLint and diff checks passed; local CLI package consistency check passed.
The commit was created without Git hooks; this is not full pre-commit gate
acceptance. Next route type generation and TypeScript `tsc --noEmit` passed,
output `/tmp/rift-typecheck-current.log`. Full-suite gate and clean release checkout
remain outstanding.
