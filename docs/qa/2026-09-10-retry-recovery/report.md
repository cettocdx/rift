# Completed-request retry recovery

The 14:18 recording shows a completed-request rejection with Retry, followed
by a start-in-progress conflict. Worker checkpoint handling intentionally
rejects replay of already-finished requests. The UI recovery predicate did
not recognize that rejection, so Retry called regenerate against the same
persisted user request. Concurrent retries also had no in-flight guard.

Two regressions failed before the change: completed-request Retry did not
send a new reconciliation message, and two concurrent retries sent twice.
The UI now uses Inspect and continue for finished checkpoints; this sends
one new visible request to inspect saved evidence and continue. Checkpoint
and ownership protection remain intact. Retry now has a ref guard across
cancellation and the awaited send/regenerate operation, reset in finally.

31 hook, lifecycle and error component tests passed. TypeScript and scoped
ESLint passed. This does not resolve the separately diagnosed offline Local
runner, nor prove that all server-side admission conflicts have one cause.
