# Pending terminal creation and tool receipt isolation

Baseline: `725bcf4`. These changes address reproduced lifecycle and authority
failures; they do not establish production latency or desktop parity.

## Terminal cancellation

Previously, `closeAll` could finish while a PTY factory was still pending. Its
late handle was then registered and could receive the initial command. Pending
factories also did not count against the existing concurrency cap.

The manager now reserves capacity before awaiting creation, under the existing
run-and-chat key. Abort or cleanup releases that reservation and promptly
settles the caller. The underlying creation promise remains observed: late
handles are terminated without registration; late rejections are handled.
Successful registration transfers its reservation synchronously. Cleanup of an
old reservation set cannot remove a fresh Workbench session's set.

The interactive tool checks cancellation around sandbox and credential setup,
passes its signal to creation, and closes a newly registered session if abort
arrives before initial input. Late orphan handles use the existing bounded
termination path. Other runs and subsequent Workbench sessions remain usable.

Regression coverage uses the actual manager, AsyncLocalStorage and tool control
flow with synthetic PTY/provider boundaries. It covers pending settlement,
late success/rejection, listener and timer cleanup, capacity transfer, no initial
input after abort, and cross-run isolation. Focused verification: 157 tests in
11 suites; final-source TypeScript and scoped lint passed.

Cancellation cannot retract a remote spawn request that has already been sent.
A permanently pending SDK request exposes no handle to terminate. Its caller
still settles on cancellation, and any later completion stays observed. This is
not evidence that all remote-provider failure modes have been eliminated.

## Verification screenshots

A module-global cache keyed only by provider tool-call ID could return run A's
unconsumed images to run B after B's empty/failed verification. The cache is now
owned by the run's verifier instance, still bounded to four sets and consumed
once. A new attempt clears prior images for that ID before work starts.

The verifier instance is retained across `getToolsForModel` rebuilds within the
same run. This avoids losing a valid pending visual receipt when the model's
toolset is rebuilt. Independent runs never share that instance.

Both cross-run leakage and rebuild loss were reproduced before correction.
Verifier/mutation/preview focused coverage: 35 tests in three suites. These tests
mock browser transport; no real browser capture or paid provider call is implied.

## Sandbox file upload authority

The upload gate used the current process URL even inside a captured database
scope, and metadata saving reread the service key after byte upload. Unscoped
HTTP callers could also switch database clients during file preflight.

The uploader now resolves URL, service key and client synchronously at entry and
uses that same authority for upload URL generation and metadata saving. Missing
origin authority fails before accessing sandbox files. File size checks still
precede network actions; client construction itself is local. The byte upload
uses the URL issued by that originating authority.

Four regressions failed before the fix. Final upload and database-scope coverage:
31 tests in three suites, with real scope/client selection and mocked external
transport. Existing S3/Convex fallback and oversize coverage remains in place.

## Release boundary

Worker process reuse remains disabled. These fixes do not replace the remaining
MCP policy review, an isolated deployment canary, live endurance testing or
production operational acceptance. Full combined source verification and UI
preview installation are recorded in the external release evidence report.
