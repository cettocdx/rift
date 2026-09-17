# Cloud Build interruption investigation

## Observed failure

Recorded run `run_06g8kld3bi4dp31fgqumppuv01` started at 2026-09-10 08:01:03 UTC and failed at 08:17:18 UTC. Trigger reports `TASK_RUN_UNCAUGHT_EXCEPTION`. The available trace contains no actionable exception stack. This was a worker failure, not just a browser disconnect. Do not claim the worker root cause is established.

## Verified fixes

- Reproduced Trigger core 4.5.4 `createAsyncIterableReadable`: EOF followed by abort threw an uncaught `ERR_INVALID_STATE` from a queued second controller close. A pnpm dependency patch makes closure idempotent, detaches abort listeners, propagates consumer cancellation and preserves source errors, in ESM and CJS. This explains the observed browser controller exception; correlation with the worker failure is still unproven.
- Both Convex file lookups omitted the persisted `generation` field from their return validators. Added its exact schema. Deployed to the configured development deployment. The actual previously failing image record now returns successfully with its generation metadata.
- A failed worker now has a distinct message from a lost live connection.
- Added a synchronous `uncaughtExceptionMonitor` record around the worker run, retaining run ID, error class/code and stack frames while excluding the error message. This observes rather than swallows fatal exceptions. The development worker rebuilt to 20260910.3.
- Corrected a CLI presentation fixture's snapshot typing that failed the root typecheck.

## Validation

- `node --test scripts/test-trigger-stream-lifecycle.mjs`: 10/10 pass (installed dependency).
- Focused transport, heartbeat and generated-file tests: 39/39 pass before worker-message test; transport alone 30/30 after that addition.
- `node scripts/test-worker-crash-monitor.mjs`: fatal exit retained, correlation/stack recorded, message omitted, listeners cleaned on success/failure.
- Root `pnpm exec tsc --noEmit`: pass after fixture fix.
- No claim of a clean release build or full-suite pass from these focused checks.
- No replay of the interrupted user's tool calls; no newly charged agent task started.

## External audit

Read the user's `productionreadinessreport.md` and Claude artifact. Its build failures, cancel/resume failures and latency findings are verification candidates. Scores and claims of competitor superiority are assessments, not matched benchmark evidence. The full release build, reported failing suites, production preview health and long-run recovery still need independent revalidation.
