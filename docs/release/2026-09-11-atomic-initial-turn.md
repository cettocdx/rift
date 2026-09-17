# Atomic initial turn persistence

The agent-long route now persists its initial chat/user message through one
claim-guarded Convex mutation. The mutation validates the current starting claim,
chat ownership, message role and identity, attachment ownership and project
binding. Existing-chat deletion cannot silently create a replacement. Retries
preserve the first saved content and existing hidden/attachment merge behavior.
The final pre-dispatch claim/abort check, worker admission and billing remain.

This reduces persistence/check RPCs from four to two for a new chat and three to
two for an existing chat. This is a structural saving, not yet a measured latency
claim. The initial-turn timing now includes its first claim check; compare total
route-before-dispatch time rather than individual old/new persistence buckets.

Independent review found no blockers. On the release checkout, ten focused suites
passed 193 tests, the full application typecheck passed, and diff validation was
clean. The new Convex-specific TypeScript project also passed with checking
enabled. It inherits strict application settings and root aliases, supplies the
installed Convex template's required target/library/casing settings, and includes
backend source rather than test files.

The initial `convex dev --once --typecheck enable` attempt stopped because the
repository lacked `convex/tsconfig.json`. CLI source confirms this is fatal in
enable mode before finishing the push. A subsequent self-signed certificate error
obscured that first failure; trying the system CA store did not resolve it. Adding
the missing checked configuration allowed the original command to finish normally.
TLS verification was never disabled and no certificate trust was added.

The additive backend was deployed first to the existing verified development
deployment `elated-poodle-998.eu-west-1.convex.cloud`. Function-spec inspection
confirmed `agentRunClaims:persistInitialTurn` absent before and present after.
This is not a production backend release. The old web route is compatible with
the additive backend; the new route requires the new mutation. No schema/index
migration is included. The production-built web preview was activated after the
backend check. `/login` returned 200, and the installed RIFT UI Preview reloaded
the existing transcript successfully.

## Matched startup benchmark

Commit `304ce74` passed the normal commit hook: 622 suites, 5,569 tests, 24
snapshots, application typechecking, staged lint and Local CLI freshness. One
pre-existing skipped test remains. The production web build also passed.

Twenty sequential persisted `merhaba` starts used the same Sol model, medium
effort, development worker version `20260911.6` and 746-token system prompt.
All completed with a final response and zero duplicate events. No build or
acceptance workload ran alongside this batch.

| Stage                    | Before p50 | After p50 | Before p95 | After p95 |
| ------------------------ | ---------: | --------: | ---------: | --------: |
| First response text      |   6,001 ms |  5,154 ms |   6,986 ms |  6,078 ms |
| Route before dispatch    |   1,066 ms |    864 ms |   1,766 ms |    965 ms |
| Dispatch to worker start |   1,181 ms |  1,143 ms |   1,315 ms |  1,484 ms |
| Worker before provider   |   1,119 ms |  1,064 ms |   2,682 ms |  1,876 ms |
| Provider to first text   |   1,786 ms |  1,589 ms |   2,699 ms |  2,354 ms |
| Worker text to observer  |     212 ms |    214 ms |     309 ms |    336 ms |

These use the existing harness's nearest-rank p50/p95 definitions. For an even
sample, the arithmetic median of the middle pair is instead 6,089 ms before and
5,193.5 ms after for first text. Stage quantiles are not additive. Both batches
use the same statistic, but provider/network variability means the entire
observed end-to-end improvement cannot be attributed to this patch.

The quality gate still correctly fails the 4,000 ms first-text target; p95 is
within its 8,000 ms target. These are greeting observations, not production load,
complex-task or competitor parity acceptance. Evidence:
`/tmp/rift-startup-atomic-20-20260911.json`,
`/tmp/rift-startup-atomic-comparison.json`, and
`/tmp/rift-startup-atomic-quality.json`.

## Normal API continuation and cancellation

A dedicated new console QA chat used the ordinary console API key and issued
run-scoped read tokens. The initial reply completed. A new agent-long turn then
recalled the exact randomized nonce from history without receiving the nonce
again. Route-level regeneration completed with the accepted user-message count
unchanged. This does not cover the UI's preceding assistant-deletion mutation:
the route-only check retained the prior assistant answer.

One foreground `sleep 60` call was observed before canceling. A concurrent start
on that same chat returned 409, cancellation returned 200 with `canceled: true`,
the run reached authoritative `CANCELED`, and resume returned 204. A subsequent
new turn completed. History held exactly one entry per accepted user message;
the rejected concurrent request was absent. Four small responses completed and
one harmless sleep was canceled. Evidence: `/tmp/rift-atomic-api-acceptance.json`.

## Remaining worker setup diagnosis

Existing numeric setup telemetry now also times `historyFetch`, conditional
`historyRetarget`, and `runRecord`. The first timer begins after its prerequisite
balance promise resolves and includes history reads/truncation. Missing retarget
means no second history fetch occurred. Run-record timing includes best-effort
failures, so it alone does not prove a record was created. These timings may
overlap other setup operations and must not be summed as critical-path time.
No order, cache, retry, permission or billing behavior changed. Independent
review verified that later run-record measurements republish the accumulated
metadata, so they are not lost to an earlier snapshot.

Local evidence: `/tmp/rift-atomic-main-focused.log`,
`/tmp/rift-atomic-main-typecheck.log`, `/tmp/rift-convex-typecheck.log`,
`/tmp/rift-convex-atomic-deploy-config-fix.log`, and
`/tmp/rift-convex-atomic-verified.json`. These are machine-local observations,
not portable release artifacts or proof of production readiness.
