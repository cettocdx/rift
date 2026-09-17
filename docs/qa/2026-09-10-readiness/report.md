# RIFT readiness audit — 2026-09-10

Scope: the supplied productionreadinessreport.md, checked against the active
`codex/reference-ui-rebuild` checkout. This is not a production-readiness or
competitor-parity certification.

## Verified fixes

- Trigger 4.5.4 stream close/abort race patched in both package distributions.
  Installed-package lifecycle checks pass; synchronous crash monitor added for
  correlating future worker exceptions. This does NOT prove the cause of the
  original 16-minute worker failure (see separate disconnection report).
- File retrieval validators now include persisted generation metadata; real
  Convex lookup of the previously failing generated file succeeds.
- Worker failure is distinguished from a disconnected UI transport.
- Terminal client and Hack session subscriptions use external stores instead
  of effect-driven duplicate state. HackerMode stop status uses React state;
  elapsed time resets at run start instead of a synchronous effect.
- Storage-disabled Hack sessions survive remounts and remain account-scoped.
- Draft cleanup retains the ref object and flushes current text on navigation.
- Prompt budget overflow corrected by removing repeated Ask style guidance,
  without widening the budget. Expected snapshots updated separately.
- Obsolete model aliases / style / launch fixture assertions updated. Behavioral
  stop, ownership, resume, stream and approval checks remain in the suite.
- Bun OpenTUI tests run under Bun, not Jest; they were not removed from coverage.
- Production preview HTTP 500 reproduced: its active build directory lacked
  required-server-files.json and server/pages/500.html. A separately built
  release served HTTP 200. Build/start scripts now use unique output folders
  and an atomic validated release pointer; incomplete builds cannot replace it.
- Retired OpenCode LLM proxy returns 410 by default before lease/provider work.
  Explicit RIFT_LEGACY_LLM_PROXY_ENABLED=true permits migration use; the existing
  disable switch and authentication/billing protections still apply.
- Legacy Tauri shell has a separate development identity and packaging disabled.
  Root tauri:build / tauri:dev forward to the canonical packages/desktop project.
  The installed native binary is not claimed rebuilt by this source change.

## Verification evidence

Evidence logs are under /tmp/rift-readiness-* on this Mac.

- Initial Jest: 5,280 tests, 24 failures, one optional live test skipped.
- First repaired full run: 600 suites, 5,302 passed, one optional test skipped.
- Root TypeScript and lint passed; lint zero errors and zero warnings.
- Console Node suite: 56 passed. OpenTUI Bun suite: 10 passed.
- Installed Trigger lifecycle and worker-crash monitor: 11 passed.
- Proxy retirement + desktop contracts: 21 passed before adding explicit
  canonical-shell regression; storage-disabled session regression: 4 passed.
- Fresh production build completed; browser opened authenticated New Chat and
  the right terminal panel. HTTP GET / returned 200; retired proxy POST 410.
- Three Cloud runs completed while their UI observer was detached; reconnect
  delivered completion with zero duplicate event IDs. These are short tasks,
  not evidence for arbitrary long-task resilience.

## Performance results and limitations

Production server, three short Cloud Build requests, build-codex / medium:
first text 6.585–14.638 s, median 9.132 s; admission median 2.240 s;
worker preparation median 4.415 s. The 4-second median target is NOT met.
The disconnect benchmark waits for task completion before reattaching: its
firstText value measures delayed replay, not normal first-token latency.

WebKit 26 isolated mixed component replay, 200 historical messages, 600 updates,
9 sustained interaction cycles: frame p95 31 ms, max 59 ms, one frame >50 ms,
none >100 ms. Draft/link/final text retained; disclosures and keyboard checks
passed. This is a 16.5-second component fixture, not a whole-app/native benchmark.
Two earlier runs timed out on disclosure. Sustained test incorrectly toggled
an already-open group closed before asserting open; corrected. The short-run
failure still needs attribution; do not erase that evidence or claim all UI
interaction failures resolved.

## Open work — not fixed or certified

1. Original fatal worker exit: no original exception stack available. Exercise
   longer real tasks and capture the new correlated fatal record if repeated.
2. Reduce measured admission / preparation / provider startup latency without
   removing ownership, moderation, billing or durable execution guarantees.
3. Full native WebKit route/panel profiling and comparative Cursor/Claude tests;
   account for long output, scrolling, media and cold routes independently.
4. Remaining legacy OpenCode modules/schema migration: retain replay and old
   data until readers and migration requirements are verified. Route is gated.
5. Large GlobalState and large chat/HackerMode decomposition require measured
   invalidation analysis; file size alone is not evidence of runtime failure.
6. Landing/settings consolidation is not done. Do not delete routes blindly.
7. Hundreds of preexisting working-tree changes remain. No blanket commit,
   release, or clean-checkout reproducibility claim has been made.

## Final verification pass

After proxy gating, canonical-shell assertion and storage fallback regression:
600/600 Jest suites passed, 5,306 tests passed, all 24 snapshots passed; one
opt-in live test skipped in the offline suite. That test was then run explicitly:
all six registry tests passed and the live adapter returned 446 entries
(truncated by its bounded scan). Lint remained at zero warnings/errors and
root TypeScript passed. A fresh immutable production build completed again.
The final short WebKit rerun also passed disclosure checks (p95 19 ms, max
85 ms, one frame >50 ms). Earlier timeouts remain recorded above; a single
passing rerun is insufficient to establish absence of intermittent interaction
failures. No result is a Cursor/Claude/Codex parity benchmark.

## Tracked billing preflight and real terminal continuity

The worker reused its already loaded balance instead of fetching it again.
Both chat paths now use `runTrackedPreflight`: reservation is registered with
the refund tracker immediately on resolution, and all concurrent checks settle
before an error reaches cleanup. Previously, a failed monthly snapshot could
reach cleanup before a slower reservation was recorded. Four regression tests
cover the ordering, free claims, denied reservations and successful results.
No billing, ownership or moderation check was removed.

Verification: 601 Jest suites passed, 5,310 tests passed, one opt-in test skipped,
24 snapshots passed; lint and root TypeScript passed. Immutable release build
completed successfully. Evidence: `/tmp/rift-preflight-*`.

Three development-server greeting runs on worker 20260910.7 completed: first
text median 9.185 s (8.809–15.320 s), worker preparation median 2.864 s
(2.574–3.163 s). This is not an apples-to-apples speedup against the earlier
production-server run; the overall latency target remains unmet.

Real Cloud shell soak `run_06g8ld9qb52mbm3lmnetp5dp01` ran 18 read-only markers
separated by 10-second sleeps. UI detached after command dispatch; the worker
completed while detached, then replay contained the actual terminal output
RIFT_SOAK_17 and final RIFT_SOAK_DONE, with zero duplicate event IDs. End-to-end
test duration was 201.212 s. Evidence: `/tmp/rift-shell-soak.json` and `.log`.
The preceding inline-Python probe did not start because it conflicted with the
tool's execution policy; the corrected probe used the shell directly. This
three-minute result does not close the original sixteen-minute fatal exit.

## Persisted-chat latency follow-up

Added `--persisted` and origin/storage labels to the startup probe. Earlier
temporary probes invoke legacy tagged-run discovery and do not represent the
normal saved-chat path. Route timing now includes project resolution and
message persistence rather than hiding them in the total.

Three saved development-server chats completed with final events and zero
duplicate event IDs; first text was 18.177, 13.195 and 16.584 seconds. The
first dispatch took 3.960 seconds and finalization 2.620 seconds; the third
worker claim took 4.008 seconds and skill loading 3.129 seconds. These samples
show substantial backend latency variation, not a measured rendering delay.
Evidence: `/tmp/rift-persisted-startup.json`. They precede the following change.

Worker entitlement and extra-usage configuration reads now execute in parallel,
with both required before any concurrency lock or billing reservation. This
removes their serial wait but no end-to-end speedup is claimed yet. Route
ownership tests: 22 passed. Billing configuration and tracked-preflight tests:
22 passed. Root TypeScript passed. The production preview has not been rebuilt
for this follow-up instrumentation; development worker applies source changes.

## Captured S2 failure and SDK tracing-chain repair

Live run `run_06g8ljnhue1nop4ldosnhr7b01` produced a model response but then
failed with an uncaught `S2Error` / `CONNECTION_TIMEOUT`, captured by the worker
monitor at 2026-09-10T10:13:55.176Z. This is a newly reproduced failure; it does
not establish the unseen stack of the original sixteen-minute failure.

The installed Trigger SDK's `streams.pipe` attached `instance.wait().finally`
for tracing without observing the promise returned by `finally`. A rejected
stream consequently generated an unhandled rejection even when the caller
caught `waitUntilComplete`. The persisted patch for SDK 4.5.4 changes that
internal chain to handle both outcomes; callers still receive the original
failure. ESM and CommonJS subprocess tests with strict rejection mode failed
before the fix (2 failures / 2 success controls), then passed after patching.
Together with core stream lifecycle and fatal-monitor tests, 15 tests passed.
This prevents an avoidable fatal rejection; it does not make S2 outages vanish
or claim guaranteed delivery when the upstream store remains unavailable.

Also reused the route's server-read chat snapshot during initial admission.
Remote liveness still forces a fresh read; reservation still atomically checks
ownership and expected mapping. Temporary-chat collision checks remain intact.
Three new tests failed before implementation and passed afterward.

Provider baseline: three direct OpenRouter Sol/medium bare greetings began at
1.935, 2.467, 1.598 seconds. RIFT adds system instructions and tools, so these
are not identical-payload timings and must not be subtracted as exact overhead.
A follow-up three-minute real shell run completed while detached in 212.285 s,
replaying the terminal's final marker with zero duplicate events (worker .8,
before the SDK patch). Evidence: `/tmp/rift-followup-soak.json`.

## Review of the additional readiness report

The supplied report in attachment 23901600-dfa6-4d02-bae8-19298305ba31 agrees
with the recorded clean type/lint/build checks and earlier 5,310-test result.
Its production approval and absolute continuity claims are not accepted:
the newly captured S2 crash is contrary evidence. The isolated fluidity fixture
cannot establish native whole-app parity. Its competitor latency ranges,
zero-ms input claim, architecture descriptions and restricted capability
claims need independent evidence; ChatGPT/Codex identification also needs to
be resolved before treating its matrix as a measured comparison.

Retain the uncommitted-work review and canonical desktop packaging as open
release items. Do not automatically delete legacy schemas or commit hundreds
of unrelated changes based on this report. Existing data compatibility must
be checked before retiring readers. Numerical scores are reviewer opinions,
not release acceptance criteria.

Final focused verification after the SDK patch: 51 claim/ownership/preflight
tests passed, 15 installed dependency/process tests passed, root TypeScript
and scoped lint passed. New immutable production build completed successfully.

Patched worker 20260910.11 + rebuilt production preview: three saved-chat
runs completed with final stream events and zero duplicates. First-text times
11.575 / 14.686 / 8.901 seconds (median 11.575 s). Thus the <=4-second target
is still unmet. Evidence `/tmp/rift-final-startup-ready.json`. The initial
probe was launched before the restarted server listened and failed locally;
it has no run handles and is excluded, retained in `/tmp/rift-final-startup.json`.
Production HTTP root returned 200. No new uncaught worker record appeared
in this bounded final check; this is not an indefinite availability claim.

## Same-request paid balance reuse

Paid runs previously fetched personal balance for extra-usage configuration,
then fetched it again to check the legacy ledger migration marker. The worker
now loads personal balance alongside other independent setup reads and shares
that server result with configuration and migration checks. The migration
snapshot carries the user ID and rejects mismatched owners or null reads.
Actual spending still uses the authoritative atomic deduction. Team funding
and free-context selection are unchanged; no cross-request balance cache exists.

Three newly added migration tests failed before the fix. With the propagation
regression, the broader billing/rate-limit suite passes 200 tests (19 suites).
Root TypeScript and scoped lint pass. Three live saved-chat runs completed,
with final events and no duplicates. billingConfig was 0/1/0 ms; billingReserve
was 1030/324/377 ms. First text was 11.946/14.945/8.423 s. These observations
confirm the removed read, not a statistically established end-to-end speedup.
Evidence: `/tmp/rift-balance-startup.json`, `/tmp/rift-balance-regression.log`.

Latest worker 20260910.13 (including SDK rejection fix): real 18-marker shell
soak completed while its observer was detached. Reattachment verified actual
terminal marker RIFT_SOAK_17, final RIFT_SOAK_DONE and zero duplicate event IDs.
Total probe time 205.588 seconds. Evidence `/tmp/rift-balance-soak.json`.
Fresh production build passed and port 3022 was restarted onto it; root HTTP
check returned 200. This bounded test does not certify all long-run failures.

## Overlapped stream environment discovery

Run-token environment discovery now begins after route ownership/project
validation, overlapping claim and persistence work. Preparation signs no token;
run-scoped signing remains after Trigger dispatch. Failed discovery is evicted
and the existing token path retries normally. Credential/API rotation and TTL
checks remain enforced. Two new tests failed before implementation; all 65
startup/token/route/resume/cancel tests pass after it, with clean TypeScript
and scoped lint.

Three live saved-chat tasks completed with final events and no duplicate IDs.
Finalization took 267/339/187 ms. First text was 14.009/12.751/9.876 seconds;
median admission 5.418 s. Thus no overall speedup is established and the <=4s
objective remains unmet. Evidence `/tmp/rift-discovery-startup.json`. Large
variation in distributed calls remains material despite removing serial work.

Production build completed successfully. Port 3022 was restarted onto this
release and returned HTTP 200; the server reported ready in 270 ms. This is
a startup availability check, not a browser interaction performance result.
