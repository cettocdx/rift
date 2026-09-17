# Automatic completion of reconciled Build cleanup

The existing three-minute observer reconnect and cooperative Stop proofs were retained, not rerun. A new live test isolated the previously unverified post-response receipt recovery path on current Preview.

Before: run `run_06g9tqrnvhfigoee5p005q8b01` returned Stop 202 cleanup_pending; its producer completed and the automatic callback recovered all remote exit receipts, but the claim remained active. The worker had completed resource draining and integration closure, then the pending journal made the final cleanup confirmation return false. The callback saved exit evidence but never finished the claim. The old fixture was administratively released only after its independently verified exit and deployed finalizer evidence; that release is not an automatic recovery result.

Change: the worker publishes separate cleanupDrained evidence after remote draining and integration closure. Receipt reconciliation can finish a terminal Build claim only with that proof, no unresolved exit receipts, and fresh owner/claim/run-bound backend confirmation. The backend rechecks pending resources and replacement ownership before release and clears only the matching active chat handle. Hack runs are excluded because their dispatch cleanup receipt is separate. A crashed worker without drain proof remains uncertain; this does not introduce automatic command replay or full hard-worker-death recovery.

Validation: the new completion regression failed before implementation. Receipt-reconciliation and cancel-route suites then passed 53 tests. ESLint and the production build passed. Post-change live verification follows below.

Post-change Preview was published as `.next-ui-release-1789372893746-pre-effects`. A second fixture (`run_06g9tt24uipv884n4q2aqvuf01`) confirmed the new worker cleanupDrained=true metadata, but its sandbox disappeared during the external fixture launch, before any final receipt could be produced. The SDK reported the sandbox not running, then not found. This is not an end-to-end passing recovery test. Its reserved synthetic resource and claim deliberately remain unconfirmed; recordNotStarted was not misused after SDK dispatch, and no fabricated exit receipt was supplied. This isolated chat is `8b86e7ba-611c-4dd9-bb70-e22a35e6c949`, resource `46f6f2d3-1d4b-4c5b-9119-5fa949ea5a06`, sandbox `ibznznx0qjsgsamkzqikg`. Resolving authoritative sandbox-destruction evidence is a separate recovery gap. Do not blindly release this fixture or count the live test as passing.

Evidence files: `/tmp/rift-live-automatic-exit-proof.json`, `/tmp/rift-live-automatic-release-proof.json`, `/tmp/rift-finish-isolated-recovery.log`. No shared worker was stopped, no real user command was replayed, and no claim without the stated evidence was reported recovered.

## Recovery adapter ownership/origin follow-up

The API adapter incorrectly compared only `metadata.userID` with the account ID.
Project sandboxes store an opaque namespace there and keep the account in
`ownerUserID`; those valid sandboxes were rejected. The adapter now honors the
explicit owner (including rejecting conflicts) and preserves the scoped sandbox
connection configuration, including accessToken and disabled environment fallback.

The new adapter tests failed in three cases before the fix, then passed. Combined
receipt/cancel/adapter validation: 62 tests passed; ESLint, TypeScript and diff
whitespace checks passed. This follow-up is source-only, not published yet.

The isolated missing-sandbox fixture still has a terminal producer, cleanupDrained
true, cleanupConfirmed false and an active claim. This remains an open limitation;
no receipt or successful exit was fabricated. Provider not-found, auth failure,
timeout and paused states explicitly cannot release the claim in these tests.

## Confirmed missing-sandbox recovery

Added a separate `sandbox_absent` resource state. Recovery requires a terminal
agent-long producer with cleanupDrained proof, typed SDK control-plane not-found,
a fully paginated authenticated inventory including running and paused VMs, and
a second typed not-found check. Generic errors, timeout, auth failure, incomplete
inventory, existing/paused VMs, and absent drain proof do not settle the resource.
The exact owner/run/resource binding is checked before writing. No command exit
success is fabricated and no command is replayed. Existing cleanup confirmation
and release CAS guards remain in effect.

Backend deployed with Convex typechecking. Live recovery of the existing isolated
fixture run_06g9tt24uipv884n4q2aqvuf01 returned reconciled=1, unconfirmed=0,
released=true. Evidence: /tmp/rift-sandbox-absence-live-proof.json. This is a live
adapter recovery, not a new full-duration task or a hard-worker-death guarantee.
Targeted absence/reconciliation/backend/adapter and cancel tests passed;
TypeScript and ESLint passed. Provider inventory semantics checked against
https://e2b.dev/docs/sdk-reference/js-sdk/v2.6.2/sandbox and the installed SDK.

Production build succeeded and Preview was published as
`.next-ui-release-1789375786059-pre-effects`. The publish gate at
2026-09-14T08:53:00.633Z found 308 released claims, zero active/starting claims,
and no mapped streaming chat. Shared Trigger worker was not restarted.
