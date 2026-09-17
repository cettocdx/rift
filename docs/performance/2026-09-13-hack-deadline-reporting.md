# Hack request deadlines and recovery — 13 September 2026

## Observed failure

The saved Hack session `5b6a2a1d-8919-46a0-811b-050beff0a6cd`, run `c6e2c24d-f85a-46b6-a544-f9bcea061741`, ended with `finish_reason: timeout` and `status: completed_with_warnings`. It contained an interim statement about checking saved pages and preparing a report. The preceding UI fix preserves that text as a partial response rather than displaying a completion check.

The endpoint's hard deadline is 370 seconds after request admission, below the platform's 420-second ceiling. Previously the step-boundary elapsed limit started after connection/setup work, using the model-stream telemetry clock. There was no separate reporting window. An in-flight command or generation could consume the request's entire remaining lifetime.

## Reporting reserve implementation

Only the dedicated Hack route opts into a 45-second reporting reserve within the same 370-second request deadline. At a safe step boundary at or after 325 seconds from admission, the runner requests one concise report from existing evidence with the provider helper's supported low-reasoning setting. Work already completed before that boundary still finishes normally. Stream latency telemetry retains its original model-stream clock.

The runner disables exposed tools and guards their actual executors, including tools discovered lazily. This second guard is necessary because the SDK can execute a provider-emitted tool call against the full tool set even when `activeTools` is empty. Reporting does not compact context again or discover more tools; preparation that crosses the reserve is rechecked before the provider request. The report retains `preemptive-timeout` and an incomplete run status rather than claiming task completion.

The primary and already-admitted fallback now share run-record finalization. Previously the fallback branch skipped the primary finalizer without writing its own run-completion receipt. A report cannot start a new empty-response fallback. A fallback admitted earlier keeps the same absolute deadline and can enter the reporting phase itself. Manual cancellation clears the report's cutoff reason; both timer-triggered and runner-detected hard deadlines remain timeout outcomes.

The hard timer now preserves an earlier AbortController cancellation. Two new regressions demonstrated that a timer firing during cleanup previously relabeled both an earlier Stop and budget abort as a preemptive timeout. The timer no longer overwrites that first cause. This does not redesign the application's separate budget-versus-user cancellation classification.

Root verification: **130 tests passed across 10 suites**, covering the real SDK loop with scripted provider responses, reporting/tool rejection, setup and preparation deadlines, summary preservation, lazy tools, approval/stop/budget boundaries, checkpoint failure, fallback reporting/cancellation, usage, and resume guidance. Log: `/tmp/rift-hack-deadline-root-tests.log`. The timer race's initial two failures are recorded in `/tmp/rift-timeout-first-abort-red.log`.

### Follow-up: successful fallback retaining an old error

A further real-SDK UI-stream regression reproduced a provider error after response metadata: the primary leaves exactly one `step-start` part, allowing the existing automatic-model fallback, but its `providerError` survived into the successful fallback and marked that run failed. A rejection before any response metadata does not satisfy this particular fallback trigger; the test distinguishes those cases.

Both already-authorized fallback boundaries now clear only provider-attempt error/input bookkeeping. They first check the original abort signal and preserve terminal stop flags, reporting outcome and failed-checkpoint evidence. No new retry policy is introduced. Red evidence: `/tmp/rift-fallback-attempt-red.log` (expected completed, observed failed); focused agent verification: `/tmp/rift-fallback-attempt-green.log` (45 tests across five suites). The test drives the real SDK UI `onFinish` path with local scripted responses; it is not a live provider request.

## Recovery guidance

The manual continuation prompt previously recognized `preemptive-timeout` but omitted the persisted literal `timeout` reason. Both now instruct the agent to inspect saved files and command results, verify any still-running session/process, and avoid replaying commands with uncertain outcomes. The prompt does not guarantee all work was preserved and does not override a user's new task.

Security terminal guidance previously recommended scans lasting up to seven minutes, longer than the entire HTTP request budget. It now asks for short checks within the remaining request budget, time to report, saved output, and verification before retrying a command whose observation ended. This guidance alone does not enforce process lifetime.

Red/green evidence: the new literal-timeout, preemptive-timeout and command-guidance regressions failed against the old behavior (3 failed, 40 passed), then the two relevant suites passed all 43 tests. Logs: `/tmp/rift-timeout-guidance-red.log` and `/tmp/rift-timeout-guidance-green.log`.

## Remaining architectural limits

Reporting time is not durable execution. Hack still uses an HTTP producer; resumable client observation does not resume a producer after it has ended. Durable security execution needs an explicit checkpoint owner, restored model/tool state, and verified command outcomes before it can safely continue across producer lifetimes. Build-only automatic continuation must not be widened to security as a substitute.

An already-running step or a slow provider can still consume the remaining request time. Ending cloud command observation does not prove its process stopped. A partial report must therefore retain an incomplete outcome, and a manual stop or exhausted budget must not start another generation. No live security scans were run for this investigation.

## Next durability work

The read-only worker audit identified these required seams; they are not implemented by reporting reserve changes:

1. Introduce dedicated security dispatch/resume admission. Generic `app/api/agent-long/route.ts`, its resume route, and `trigger/agent-long.ts` deliberately reject security today. Recheck account ownership and Max access, and bind the worker to server-authorized security context rather than a client capability flag.
2. Extend the worker's persistent checkpoint eligibility beyond its current app-only admission deliberately. Include authorized scope, approval policy, request identity and ownership in recovery validation. A changed target or revoked permission must not inherit an old execution claim.
3. Preserve the checkpoint effect barrier for terminal and MCP operations. An uncertain external action is not safe to replay merely because a worker restarted or an acknowledgement was lost.
4. Reconcile PTY/process state. A restored transcript session ID does not prove the old session remains live; worker cleanup closes run-scoped PTYs. Saved evidence and observed exit status must remain distinct.
5. Before enabling this path, test forged dispatch, access revocation, duplicate delivery, startup/tool cancellation, approval decisions, crash boundaries around effect marking, lost checkpoint acknowledgements, stale PTYs, incompatible checkpoints and incomplete outcome persistence. Keep automatic timeout continuation app-only.
