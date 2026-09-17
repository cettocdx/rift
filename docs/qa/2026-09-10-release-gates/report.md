# Release gate follow-up — 2026-09-10

## Completed in this pass
- Aligned web-test and desktop CI with Node 22, already used by the worker and CLI release workflow.
- Made the full test workflow reusable and required it before desktop builds. Removed unused write permissions from the test job. YAML parsing and dependency checks passed locally; no GitHub workflow was dispatched or published.
- Full Jest run initially found one brittle source-wiring assertion after timing instrumentation wrapped project resolution. Updated the assertion to recognize the resolver call and added a behavioral test: while project authorization is pending, and after denial, no local sandbox, reservation, persistence or dispatch occurs.
- Full rerun: **607 suites passed; 5,349 tests passed, one skipped; 24 snapshots passed**. Root TypeScript and targeted ESLint passed. See full-before.log and full-after.log.
- CLI: 56 Node tests and 10 OpenTUI tests passed. Built the ARM64 standalone release and installed it in a fresh temporary directory with isolated config. Help, absent authentication, Bun runtime, update backup and rejection of a deliberately corrupted binary passed. The checksum error in cli-install.log is the expected negative test, not an installation failure. No user's CLI configuration was replaced.

## Live continuity evidence
- First 90-second isolated outage: 60/60 output markers, no duplicates, command execution count one. The following restart scenario timed out before its result, so this complete run FAILED. Preserve local-90s.json; do not call it a complete continuity pass.
- Instrumented 15-second repeat: output recovery, SIGKILL launcher restart with same connection ID, original command completing exactly once, subsequent command, and cancellation (exit 130) all passed. See local-15s-diagnostic.json.
- Diagnostic scripts operate on their own runner/process/proxy and do not disconnect the user's runner or network. New stage and connection-count diagnostics distinguish subsequent admission failures from command execution failures.

## Still open
Under-four-second startup; native app lifecycle/whole-app UI acceptance; production worker deployment; reviewed source commits and clean-checkout reproduction; Apple distribution signing/notarization; legacy data migration; comprehensive multi-user security and backup/restore qualification. No public release was made. Test success alone is not release approval.

## Command admission fix and verification
The 90-second failure reproduced twice at the *next command admission* stage, despite complete delivery of the previous command. The command receiver and detached output worker reconnect independently; relay transport/publish acknowledgement did not prove that the command receiver was subscribed.

Added capability-negotiated readiness probes with a per-command nonce. Only the main receiver responds. Harmless probes may repeat for up to 10 seconds; the actual command is published once after readiness. Cancellation releases the probe subscription/timers. This is not a durable command-acknowledgement queue and cannot guarantee delivery if the receiver dies immediately after acknowledgement. Older runners without the new capability retain the compatibility path and need upgrading to get this guard.

- Two 90-second outage + SIGKILL launcher restart sequences passed after the fix: 60/60 markers, zero duplicate output, execution count one, same connection identity, subsequent command exit 0, cancellation exit 130. See local-90s-readiness.json and local-90s-readiness-repeat.json. Preserve the original failing evidence above.
- Sender/readiness tests: 32 passed; Local selection/presence compatibility tests: 16 passed.
- Full regression after sender change: 608 suites, 5,354 passed, one skipped, 24 snapshots (readiness-full-tests.log).
- Three additional capability authorization tests passed separately: other-owner update denied, no implicit command/PTY permission grant, existing permissions preserved.
- Local runner built; capability schema deployed to the existing development Convex deployment. Root TypeScript and targeted lint passed. Production frontend build completed.
- Restarted the managed runner and 3020 frontend using their existing LaunchAgents. Frontend returned HTTP 200. The existing managed connection advertises commandReadiness=true and the actual CentrifugoSandbox command path returned RIFT_READINESS_OK, exit 0 (managed-readiness.json).

These tests cover relay outages and launcher restarts, not whole-machine/command-worker death, every application lifecycle, or a production deployment. Startup latency remains at the last measured median 7.224 seconds; it was not remeasured or claimed below four seconds in this follow-up.

Final validation: root TypeScript and targeted ESLint returned exit 0 after the managed-command verification script was added. Both `/` and `/agents` on port 3020 returned HTTP 200. Trigger development worker rebuilt to version 20260910.26; production worker promotion remains open.
