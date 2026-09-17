# Harness interruption and startup reliability

Applied to the active reference-ui checkout, UI Preview development service, development worker, and installed local CLI 0.2.4. No public production deployment.

## Corrected causes

- Moderation had no explicit short request deadline and inherited SDK retries. It now has a 4,000 ms request timeout, no automatic retries, and the run's cancellation signal. Existing restricted fallback behavior remains unchanged. Cancellation propagates instead of becoming a successful fallback. Deferred promises have immediate rejection handlers while other preflight work runs.
- The worker recorded every tool, including a plain file read, as a possibly executed effect. A crash during that read unnecessarily blocked checkpoint recovery. Exact built-in reads now recheck ownership using the existing step mutation; effects and unknown tools still mark execution. A subsequent read cannot clear an earlier write marker. This uses existing Convex operations and does not require a schema migration.
- The local CLI restored interrupted history but did not continue safe steps. It now resumes interrupted model requests and built-in reads with the same available model. Missing read results are recorded as interrupted; the model can inspect again. Confirmed results remain intact. Unknown write/command outcomes stay blocked; explicitly stopped sessions and unavailable-model sessions do not auto-run. Approval mode still resets on restart.
- Local continuation intent remains durable between the final tool result and the next model request, including initialization of a recovered task.

## Verification

- 520 Jest checks validated across the selected harness, tool-policy, model endpoint, moderation and Convex checkpoint suites. The initial broad run found one source-contract assertion counting every cancellation-signal occurrence; the new moderation signal made its expected count obsolete. It now specifically checks the two heartbeat stream cancellation bindings, and all three tests in that suite pass on rerun.
- 51 standalone CLI tests pass, including automatic safe recovery, uncertain writes, explicit Stop, model retirement, duplicate tool identities and progress guards.
- Root TypeScript check and standalone CLI compilation pass.
- Installed `rift --version`: 0.2.4. Development worker rebuilt to 20260908.21.

## Live samples

These are individual development-service samples, not controlled before/after benchmarks or latency percentiles.

| Task | Outcome | Observations |
| --- | --- | --- |
| Reopen interrupted local read | Completed with verified content, zero errors, one user message | 6,306 ms; two model requests, one newly requested read; pending marker cleared |
| Local read/edit/read-back | Completed, correct replacement and preservation, zero errors | 19,230 ms; four model requests, three tools; three saved tool results |
| Temporary arithmetic worker | Completed | First model chunk 6,874 ms after worker start; moderation 987 ms; MCP preparation 362 ms; observed completion 18,482 ms including admission and polling |
| Fresh “merhaba” worker | Completed | Model requested 2,992 ms after worker start; first model chunk 7,551 ms; MCP phase 0 ms; moderation 1,437 ms; observed completion 15,190 ms including admission and polling |

First model chunk may be reasoning and is not necessarily visible assistant text. The greeting sample still has material startup and provider delay; this is not yet an instant-response experience. The request deadline bounds the moderation request, not total task duration. Network/provider outages and uncertain external side effects cannot be made impossible by this change.
