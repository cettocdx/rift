# Recovering a lost HTTP task finalization acknowledgment

## Reproduction and correction

The Hack HTTP producer calls `finishHackHttpExecution` only after tool/PTY drain and persistence. Previously this was a single Convex mutation with no recovery. A transient failure before the write left the execution running; a lost response after the write rejected even though the execution was terminal. The installed Convex HTTP client's mutation implementation does not retry this operation.

Three new failure-injection tests failed before the correction (14 passed). The helper now captures its original deployment client and ownership binding, observes the exact execution after a transient acknowledgment failure, and retries only this idempotent finish mutation up to three attempts, with 250/500 ms backoff. It never repeats admission, commands, model calls, persistence or billing. An unavailable or mismatched observation is not confirmation. Authority/application errors and false acknowledgments are not converted into success.

This does not recover a killed producer, impose a task deadline, or resolve the older records with missing cleanup evidence. Individual transport requests still use their existing client timeout behavior; this is bounded by attempt count, not a new overall network deadline.

## Verification

- Before: 3 failed / 14 passed, `/tmp/rift-http-ack-red.log`.
- After: 59 passed across four suites covering HTTP cancel, actual database mutation handlers, request-handler admission/drain ordering, and in-flight tool drain: `/tmp/rift-http-ack-regression.log`.
- Real serving Convex backend acceptance ran three isolated scenarios through the actual helper. The transport error was injected; writes and reads used the real backend. No tools or models ran:
  - Lost response after commit: one acknowledgment; recovered by observing terminal state. Chat `63ac41ae-de05-41de-af76-6e148bc9fc37`.
  - Network failure before write: two acknowledgment attempts; terminal state persisted. Chat `df46c4b8-dbfb-4195-9ffa-3d9498869e47`.
  - New generation starts after old commit: old acknowledgment recovered with one attempt; the newer generation remained running until its own explicit test cleanup. Chat `2e1c0628-425b-40f8-9d8a-e499c6a9ab8c`.
- The acceptance script finished every synthetic admitted execution; output `/tmp/rift-http-ack-live.json`. Reusable script: `scripts/verify-http-finalization-recovery.ts`.
- Production build passed including TypeScript and 145 static pages: `/tmp/rift-http-ack-release.log`. Artifact `.next-ui-release-1789610131804-a30d519a`, independently served on port 3066.

## Current maintenance observation

Fresh inventories and provider observations are in `/tmp/rift-claims-turn-current.json`, `/tmp/rift-http-turn-current.json`, `/tmp/rift-producers-turn-current.json`. Seven old producers are owner-verified terminal but lack cleanup-drain evidence. One returns 404; one older HTTP execution remains recorded running. These observations do not authorize assuming resource cleanup or forcibly releasing records. The main web/worker was not restarted. The new helper is present in the independent preview; this report does not claim a completed main worker rollout or complete application reliability.

## Next live defect identified

While checking the signed-in 3066 UI, an actual completed Build chat (`c5912f7c-2cf5-462f-842d-ca2afaf08ce1`) retained “Needs attention.” All three collaborators had completed. The persisted dynamic tool `mcp_browserbase_start` had `state: output-available` but returned the string `Tool error: MCP tool call failed (Error).` The transcript summarized this as “completion not confirmed”; the main agent described browser automation as unavailable and used render verification instead. Owner-scoped evidence is saved locally in `/tmp/rift-brevier-assistant-parts.json`. This is distinct from the acknowledgment defect and remains to be investigated. Do not rerun or alter the user's completed project to diagnose the connector.
