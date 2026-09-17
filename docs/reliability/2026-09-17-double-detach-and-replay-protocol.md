# Repeated reader disconnect and saved-answer recovery

## Live acceptance

The isolated 3076 production build ran one harmless Hack task through normal
API-key authentication. Its only terminal command printed three markers around
two 45-second waits. It did not scan a target, edit files, install packages or
delegate. The original reader detached after command admission. A second reader
attached, detached after eight seconds, and a third observed completion.

- Chat: `3ac7ae9b-f3ef-4947-9bac-680fd17d7ad6`.
- Execution: `03bfabaa-789a-4ee8-bbd4-3ba2b2c7b3d4`.
- First detach: 17,580 ms; GET attachments at 23,980 and 38,400 ms both returned
  HTTP 200 and the exact same execution identity.
- End-to-end: 118,206 ms. One unique terminal call, one finish event, zero
  stream errors, all three output markers, terminal exit code 0.
- A subsequent authenticated GET returned one persisted assistant message
  (`449669ce-4323-44e1-bdc1-6c3f1e958ca1`) with all markers through the
  `data-appendMessage` replay protocol. Replay uses that stored message identity;
  absence of live start/finish events in this protocol is not missing output.
- Reported usage: 40,418 total tokens, 39,530 input, $0.05482 cost metadata.
  This is the observed request metadata, not an independent billing reconciliation.

Receipts: `/tmp/rift-hack-double-detach.log`,
`/tmp/rift-hack-double-detach-result.json`,
`/tmp/rift-hack-double-detach-replay.json`.

This proves repeated reader detachment while the producer survives. It does not
prove worker death recovery, multi-hour execution, native background operation or
production deployment. Current local configuration leaves durable Hack and durable
admission disabled/unset. The HTTP route retains its 370-second preemptive
deadline inside its 420-second route duration. General long-task acceptance
requires the separate durable path; this short live pass cannot substitute for it.

## Defects found during completed-task replay

The actual saved-answer response had no Content-Type. All success branches used
plain Response objects without the AI SDK's SSE protocol headers. They now use
the installed SDK's UI message stream headers plus `private, no-store`, retaining
the exact execution ID only when one exists. The anti-buffering header is included;
this does not establish that all upstream proxies honor it.

Inspection also found that a database failure when loading a saved answer became
HTTP 200 with an empty DONE stream. Two new regressions reproduced that failure
and missing client recovery. The route now returns a chat-bound, noncacheable 503
`replay-pending` response. Hack transport turns only an exact-chat GET response
into its existing retryable observation error. It never invents an active
execution ID or POSTs the original task. Unrelated and unmarked failures retain
their original handling.

Validation:

- Header regressions initially failed on each exercised success path.
- Saved-answer failure regressions: 2 failed / 47 passed before correction.
- Route, transport, cleanup: 51 passed after correction.
- Automatic resume, SDK recovery and duplicate-response tests: 31 passed.
- Current specialist provider retry/read/usage tests: 41 passed. These use the
  real installed SDK with a controlled provider, not a new paid specialist task.
- Scoped lint and diff whitespace checks passed.

Logs: `/tmp/rift-reconnect-headers-red.log`,
`/tmp/rift-replay-failure-red.log`, `/tmp/rift-replay-failure-green.log`,
`/tmp/rift-replay-autoresume-regression.log`,
`/tmp/rift-current-delegate-verification.log`,
`/tmp/rift-replay-failure-lint.log`.

The live detach test preceded these protocol corrections. The fresh production
build exited zero (`/tmp/rift-replay-recovery-build.log`); immutable output
`.next-ui-release-1789619353306-db41b88e` is separately served on port 3077.
An authenticated GET against 3077 returned the same persisted assistant ID with
`text/event-stream`, `private, no-store`, protocol `v1` and anti-buffering `no`.
Receipt: `/tmp/rift-replay-3077-live.json`. No second task was submitted for this
check. Main web/worker and public promotion remain unchanged.
