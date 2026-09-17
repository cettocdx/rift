# Atomic worker cleanup registration

Worker activation can now register its mandatory remote-cleanup fence in the same owner-bound Convex transaction. The worker requests this flag and skips the separate registration request only when the response explicitly acknowledges it. The previous explicit registration remains as a response-compatibility fallback. Normal route activation retains its existing contract.

This removes one serial network round trip without caching authorization or removing cancellation, chat ownership, worker-entry, dispatch-stop, or pre-effect checks. An already cleanup-confirmed worker cannot reactivate this path. A newly activated worker cannot be released until its cleanup is confirmed.

## Validation

- New backend tests first failed for both missing atomic fencing and attempted reactivation after cleanup; both passed after implementation.
- Backend plus worker-client tests: 146 passed.
- Backend was deployed before the watched worker started requesting the optional flag. Worker version 20260914.8.
- Actual Stop run `run_06g9r09emdefr08bok4vgju701`: remote command observed, Stop HTTP 200/canceled=true, zero matching processes afterwards, producer COMPLETED. Evidence `/tmp/rift-build-stop-atomic-cleanup-result.json`.

## Startup observations

Same production-built local web, local development worker, build-codex, medium effort, fresh persisted conversations. No build or test suite was running during either three-scenario batch. These are single samples per scenario, not performance percentiles or causal estimates.

| Scenario    | Before first text | After first text | After model requested (worker-relative) |
| ----------- | ----------------: | ---------------: | --------------------------------------: |
| Greeting    |          13,514ms |          6,304ms |                                   988ms |
| Explanation |           8,473ms |          5,932ms |                                 2,160ms |
| Terminal    |          17,549ms |         13,955ms |                                 1,030ms |

All six producers completed without duplicate observed stream events. The post-change terminal command exited 0 and returned the expected marker, but failed the strict scenario acceptance because the model changed the literal printf format's escaped newline to a newline. The benchmark was not weakened; this sample is not counted as fully verified.

The large before/after first-text difference cannot be attributed to one removed request. The first baseline run had a 7,454ms signed provider-attempt-to-handler wall-clock interval, compared with 1,146ms after; clock boundaries and development-worker startup must be accounted for. The baseline also observed substantial unrelated desktop CPU load. Provider request-to-text varied independently. The terminal's first tool input appeared at 8,647ms after the change, before its final text; neither met the 4-second target.

Evidence: `/tmp/rift-startup-20260914-baseline.json`, `/tmp/rift-startup-20260914-atomic-cleanup.json`, `/tmp/rift-startup-command-deviation.json`.

The four-second goal remains unmet. Hosted worker startup, provider latency, meaningful cold/warm sample sizes and UI paint require further work; this change does not establish production or competitor parity.

## Full gate pending due to host resource pressure

The commit hook passed type generation/type checking, then the full Jest run became heavily delayed and many unrelated UI/network test cases timed out. The host reported load average 282, approximately 86MB unused memory and 149 running processes. Only the verified RIFT Jest parent PID 24573 was interrupted; its known child PIDs 24638/24639 subsequently disappeared. The hook ended with code 130 and no commit was created. Later host load remained 367 even after those test processes exited. No user application was stopped.

The 146 focused tests and live Stop result above remain evidence of their stated scope; they do not replace the required full gate. Current changes are staged, not committed or published as a new web build. Re-run the unchanged gate when host resource pressure is resolved. Do not increase test timeouts or classify this interrupted run as passing.
