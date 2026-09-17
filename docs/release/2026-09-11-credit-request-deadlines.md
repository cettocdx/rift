# Credit request wait deadlines

Each lifecycle transport attempt now has a fixed 10-second local wait deadline.
Reserve and close retain their one same-key retry, so a fully stalled invocation
waits at most roughly 20 seconds. First-use admission never retries or grants
dispatch after timeout. Settlement retries remain caller-owned and reuse the
same immutable snapshot; the console caps submissions at two.

The race wraps the raw transport before state updates. Late success or rejection
cannot replace a timed-out phase or grant execution. Timers are cleared on every
exit, including synchronous throws, and unreferenced in Node. Existing ordering,
service authority, private bindings and shared client configuration are preserved.

Fifteen author regressions and six independent regressions cover indefinitely
pending requests, late grants/receipts/rejections, cancellation/close races,
positive closed acknowledgements, timer cleanup and the actual console route's
double-stalled settlement. Fake timers show the route ending after 20 seconds
with one model invocation, two settlement calls and no completion/tool proposal.
These fixtures are not production latency or native transaction evidence.

This deadline does not abort the remote mutation, network socket or shared client
queue. A mutation may commit later. Timeout never proves rollback, zero cost or
permission to rerun the provider. Event-loop stalls can delay timers. Uncertain
outcomes still require reconciliation; the production console gate remains off.

Reviewed patch: `7f847a7006c04512fbeac0d89405c60d81f05b743aa0a8160a1610216c52d659`.
Independent regressions: `3dc18596eb177892b2e3f1c48608afe641fbf8a5ca69fe7757e1eaedd63d8338`.
Review: `/tmp/rift-credit-deadline-independent-review.md`.
