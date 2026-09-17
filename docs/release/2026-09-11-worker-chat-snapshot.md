# Worker activation snapshot — 2026-09-11

## Change and correctness

The worker previously read a chat during claim activation and fetched the same chat again before loading history. `activateForWorker` now returns the owned post-activation chat snapshot after the transaction succeeds. Persisted workers require the chat to exist. Failed/stale activation returns no chat content.

The existing boolean `activate` and string-returning `startClaimedAgentRun` contracts remain available. Only the worker passes the new server-only snapshot instance, bound to user/chat/run, into history loading. Omitted snapshots retain the old query path; confirmed absence is distinct from omission. Serialized/request-shaped objects cannot supply the capability.

Owner-filtered history pages, summaries, file token reads, fresh project/bot resolution, regeneration, current cancellation checks and the final billing/tool admission checkpoint remain in place. The public serializer excludes legacy `codex_thread_id` and private `cancel_skip_save`; the latter was already absent from the declared return validator and remains available through the dedicated cancellation API.

## Review and rollout

- Independently reviewed patch SHA256 `419ee1213a6fdbde97c421a16cd99ee35f3607b4fbb43f05c8263fad66014a9d`; no blocking findings.
- Isolated validation: 201 tests across 13 suites, root and Convex TypeScript, changed-file ESLint passed.
- Integrated validation: 139 tests across five directly affected suites and root TypeScript passed. Logs: `/tmp/rift-snapshot-main-tests.log`, `/tmp/rift-snapshot-main-tsc.log`.
- Deployed the additive Convex API first to the existing development deployment with type checking enabled. Deployment log: `/tmp/rift-snapshot-convex-deploy.log`; live function specification confirms `agentRunClaims.js:activateForWorker` in `/tmp/rift-snapshot-convex-spec.json`.
- Confirmed no executing/queued/dequeued/waiting/pending-version tasks before applying the worker change. The watched development worker published version `20260911.9`. This is not a production worker deployment.

## Performance evidence

The code removes one chat query per history load. It does not eliminate the entire history phase: pages, summaries and files still load, and the activation response is now larger. Compare net claim/history/total latency using the matched 20-run benchmark at `/tmp/rift-startup-snapshot-20-20260911.json` against `/tmp/rift-startup-atomic-20-20260911.json`. Do not infer the end-to-end saving from query count alone.

All 20 persisted greeting tasks completed with a finish event and zero duplicate events, using `build-codex`, medium effort, 746 system prompt tokens and worker `20260911.9`. Other heavy test/build work was paused during sampling. Comparison: `/tmp/rift-snapshot-comparison.json`.

| Stage                             | Previous p50 |  New p50 | Previous p95 |  New p95 |
| --------------------------------- | -----------: | -------: | -----------: | -------: |
| User request to first text        |     5,154 ms | 4,934 ms |     6,078 ms | 6,517 ms |
| Route before dispatch             |       864 ms |   831 ms |       965 ms | 1,023 ms |
| Dispatch to worker start          |     1,143 ms | 1,182 ms |     1,484 ms | 1,826 ms |
| Worker setup before model request |     1,064 ms |   989 ms |     1,876 ms | 1,777 ms |
| Claim activation                  |       208 ms |   247 ms |       597 ms |   323 ms |
| Billing reservation               |       199 ms |   177 ms |       421 ms |   420 ms |
| Provider request to first text    |     1,589 ms | 1,646 ms |     2,354 ms | 2,289 ms |

Quantiles use the existing harness's nearest-rank convention (its `medianMs` field is p50). End-to-end maximum rose from 6,656 to 7,615 ms. The median improved modestly, but the tail did not; the sub-4-second median target remains unmet. External provider/dispatch variability means this sequential comparison does not isolate causality.

New history-fetch p50/p95 was 201/307 ms. The earlier five-run diagnostic was 367/382 ms; the preceding 20-run baseline did not yet contain this instrument, so these are unequal sample sizes and not a matched history-stage comparison. Repeated first-sample billing spikes (1,401 ms before, 1,361 ms now) warrant substage instrumentation before attributing them to a cold Node action.
