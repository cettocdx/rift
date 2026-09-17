# Live Build Stop and remote process evidence

Environment: production-mode localhost:3020 Preview, development Trigger worker,
development Convex, one isolated Python sleep command per task. No project files
were read or changed. The observer used direct E2B process inspection, matching a
unique command marker, rather than inferring exit from a UI status.

## Cooperative Stop

Run `run_06g9ps24mcjdnov4ulmuqrlc01`:

- Remote command observed at 23,208ms, one matching process.
- RIFT Stop returned HTTP200/canceled=true at 28,525ms.
- Remote inspection at 28,910ms found zero matching processes.
- Trigger status was COMPLETED (worker completed cancellation finalization).
- One acknowledged settlement journal row; cost $0.010082402777777779 and 1x
  owner pricing. This is one bounded success, not an endurance guarantee.

## Forced Trigger cancellation

Run `run_06g9psirkt0a820cad0stihp01`:

- Remote command observed at 35,734ms, one matching process.
- Direct Trigger cancel/retrieve reported CANCELED at 36,716ms.
- Remote inspection at 37,051ms still found that process (PID1925).
- This intentionally fails the immediate remote-exit acceptance condition.
- The worker later persisted one acknowledged settlement row, cost
  $0.009860694444444444 with 1x pricing. No duplicate settlement was observed.

The forced test bypassed the RIFT cooperative endpoint to exercise its fallback
assumption. It does not prove that the regular Stop endpoint always fails, nor
does it prove permanent orphaning. It proves that terminal Trigger status alone
does not establish remote process exit. A later independent inspection confirmed
zero matching processes; the exact delay until exit was not measured.

## Code boundary requiring correction

`cancelClaimedRunAndConfirm` falls back after eight seconds to
`cancelRunAndConfirm`. The latter accepts Trigger cancellation without remote
exit evidence. The route can then release the claim. Build uses the permissive
PTY scope and best-effort closeAll; its finalizer defaults cleanup confirmation
to true when there is no dedicated Hack execution drain.

Required follow-up: run Build tools under a confirmed execution drain, await
remote exit before recording cleanup acknowledgment/releasing the claim, and
make cancellation/admission respect that acknowledgment independently of Trigger
terminality. Hard worker death also needs durable resource reconciliation; an
in-process finally or a longer arbitrary timeout cannot prove cleanup. Keep
unknown cleanup fenced and preserve the exact run identity for recovery.

Evidence files: `/tmp/rift-build-stop-remote-result.json`,
`/tmp/rift-build-stop-settlement-proof.json`,
`/tmp/rift-build-force-stop-result.json`,
`/tmp/rift-build-force-stop-settlement.json`,
`/tmp/rift-force-stop-recheck.json`.

## Implementation under verification

Build workers now register a durable remote-cleanup requirement before tools can
start. Claim release and replacement admission reject an unconfirmed requirement,
even if Trigger reports a terminal status. Cancellation returns HTTP202 with
`cleanup_pending` while this proof is missing; a replaced claim is not canceled.
The client preserves its unconfirmed-cancellation behavior rather than treating
HTTP202 as permission to start a replacement.

Build uses the confirmed execution drain previously limited to Hack. Foreground
E2B commands now retain their one original wait receipt independently of tool
abort/observation completion, including late start acknowledgment. A successful
kill RPC is not exit proof. Explicit background preview processes remain under
the existing preview lifecycle; they are not registered as foreground commands.

Limits: hard worker death still needs a durable resource reconciler. Local runner
command termination and intentional background-process cleanup are separate
acceptance cases. These changes must not be described as solving every remote
resource or every disconnection. No new live validation has yet been performed
for this revision.

Validation: full Jest run passed 785 suites, 7,954 tests with one skipped,
24 snapshots (245.569s). A separately added background-preview regression also
passed with the terminal suite (40 tests). Focused cleanup, cancellation and
claim tests passed. TypeScript and focused ESLint passed before that final
background-only test addition; the mandatory commit gate rechecks the final tree.

## Live follow-up: preserve the E2B exit observation transport

The first updated live test (`run_06g9q4oml99k1rt9ka71k25u01`) correctly retained
the cleanup fence, but returned HTTP202 even though independent process inspection
found zero processes. A diagnostic repeat identified `remote_exit / SandboxError`.
A direct isolated SDK experiment confirmed that aborting the supplied request
signal destroys the wait receipt while killing the command without aborting its
transport returns a real CommandExitError receipt.

Foreground cloud execution now preserves its observation connection on user Stop.
The existing exact-handle kill/late-start kill paths still stop the command; the
local runner retains its abort signal. Unknown transport failures remain unknown.
Cleanup diagnostics record only stage and error class, never commands or secrets.

Live corrected run `run_06g9q6753kc2k59atl3ksq8901` passed: one unique Python sleep
process observed before Stop, HTTP200/canceled=true, zero matching processes after
Stop. Trigger completed its finalizer with cleanupConfirmed=true. The exact claim
was released with remote_cleanup_required=true and remote_cleanup_confirmed=true.
Exactly one acknowledged usage_settlements row was found. This proves one normal
cooperative cancellation, not hard worker-death recovery or an endurance guarantee.
Evidence: `/tmp/rift-build-stop-preserved-receipt-result.json` and
`/tmp/rift-preserved-receipt-proof.json`. Focused verification: 55 tests passed.
