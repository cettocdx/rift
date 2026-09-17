# Foreground cloud command journal integration

The claimed Build/Hack worker binds an AsyncLocalStorage journal to its exact user/chat/claim/run after backend cleanup registration. Foreground E2B exec commands now reserve before dispatch and save durable remote start/exit receipts. Local commands, interactive PTYs, persistent background previews and unclaimed HTTP execution are not covered by this integration yet.

The launch wrapper records boot ID, Linux process start ticks and a unique operation nonce before exec. Exec retains the E2B handle PID. Receipts contain no command text or credentials. A per-run remote lock and sealed marker provide a launch-fencing primitive; independent recovery must still install the seal and verify descendants before it can acknowledge cleanup after worker death. No automatic reconciler is enabled by this change.

A Stop received while reservation is in flight records `not_started` only when the SDK has never been invoked. A rejected or lost SDK response stays uncertain. The existing exact handle wait remains the exit source; transport loss is never treated as exit. Failed start/exit persistence keeps cleanup unconfirmed.

## Evidence

- 71 backend claim/journal tests, 9 journal helper tests, 44 terminal tests.
- Actual sandbox launch: PID from SDK equals persisted wrapper PID, stdout unchanged (`journal-live-ok`), exit 0. A launch submitted after creating the remote seal returns exit 125 without running the requested command; receipt PID also matches.
- Live RIFT run `run_06g9qg92n86979r3d985piao01`: one observed process (PID 2143), Stop HTTP 200 with canceled=true, zero matching remote processes afterward, Trigger COMPLETED.
- Independent durable inventory: one resource, state exited, process identity present; exact claim released, journal enabled, cleanup confirmed.
- Evidence files: `/tmp/rift-journal-live-proof.json`, `/tmp/rift-build-stop-journal-result.json`, `/tmp/rift-journal-durable-proof.json`.
- Backend additions were deployed before changing the watched worker source.

This establishes cooperative Stop with durable evidence. It does not establish recovery after abrupt worker death, descendant cleanup, first-response latency under four seconds, or production readiness.
