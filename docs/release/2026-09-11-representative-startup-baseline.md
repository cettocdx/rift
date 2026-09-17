# Representative startup baseline

Twenty sequential, authenticated, persisted requests completed against the local
production web build of `3538d71` and development worker `20260911.13`, using the
benchmark committed in `bb22b20`. Every request used `build-codex`, medium effort,
and a fresh chat ID. The fixed cycle produced seven greetings, seven short path
explanations, and six read-only cloud terminal tasks. No service restart, source
edit, build, or heavy test ran during the measurement.

All twenty runs completed with a finish event and passed their scenario evidence
checks. There were zero duplicate event IDs. All seven explanations had nonempty
text, the unique final sentinel, and no observed tool attempts. All six terminal
tasks submitted exactly one matching `run_terminal_cmd`; its actual output held
the absolute working directory and nonce, with exit code zero. Each had a matching
final sentinel. The validator does not grade explanation semantics or prove
provider-side exactly-once execution beyond the observed submissions/results.

## Measured latency

Times below are milliseconds. Quantiles use nearest rank. Each scenario has fewer
than twenty samples, so its tail values remain exploratory.

| Scenario    | Count | First text median | First text p95 | Total probe median |
| ----------- | ----: | ----------------: | -------------: | -----------------: |
| Greeting    |     7 |             5,263 |          6,833 |              8,875 |
| Explanation |     7 |             7,940 |         12,414 |             11,958 |
| Terminal    |     6 |            13,972 |         19,981 |             17,843 |

Total probe time includes waiting for the terminal Trigger run status; it is not
just the time at which the last response text appeared. Terminal first text can
arrive after command execution and a second model step. It must not be described
as idle provider startup time. Earlier tool/reasoning activity is not first text.

| Median stage                       | Greeting | Explanation | Terminal |
| ---------------------------------- | -------: | ----------: | -------: |
| HTTP admission                     |    1,552 |       1,684 |    1,622 |
| Trigger request to worker start    |    1,410 |       1,186 |    1,465 |
| Worker start to model request      |      986 |       1,539 |    1,186 |
| Model request to first model chunk |    1,692 |       3,071 |    3,622 |
| First model text to probe delivery |      217 |         216 |      212 |

These medians are not additive: admission overlaps dispatch-to-worker-start, and
each median may describe a different sample. The command tool's measured duration
was median 2,389 ms, maximum 2,926 ms, including its wrapper/environment work; it is
not a measurement of the shell's `printf` CPU time. Moderation was median 731 ms
for explanation and 442 ms for terminal, with maxima 1,932 and 1,789 ms. One
explanation's setup took 3,818 ms while several parallel remote reads each took
about 1.6 seconds. The data supports multiple latency contributors, not a single
proven bottleneck.

The quality checker correctly exited **1** for median and p95 first-text target
violations: pooled median 7,603 ms, p95 15,433 ms, maximum 19,981 ms, against the
unchanged 4,000/8,000 ms targets. There were no correctness/evidence violations.
The mixed distribution cannot be compared causally with previous greeting-only
batches. This run does not demonstrate an end-to-end speedup from the owned
admission snapshot, production-hosted dispatch performance, or competitor parity.

## Verification and next measurement

The scenario implementation passed 28 offline Node checks, independent review,
scoped lint, TypeScript, and the ordinary commit hook's 625 Jest suites (5,649
passed, one existing skip, 24 snapshots). Offline tests cover strict argument
validation before credential loading, mixed scheduling, command/result/nonce
binding, missing/unknown/error output, unexpected tool attempts, and legacy
greeting/soak behavior. They do not make real model calls.

After the web restart, the installed `/Applications/RIFT UI Preview.app` reloaded
the dedicated QA chat `77ab987f-735f-42a6-a31d-b39ccb53f2f6`; native accessibility
state showed the same one user message and one assistant response with a usable
empty composer. No new message was submitted there. During the benchmark the
native usage panel showed 111,311 available credits. No credit top-up or purchase
was performed.

The next dispatch comparison needs a hosted worker with verified isolated data,
billing, and ordinary QA authentication. The staging inventory and canary gate
are recorded separately. Do not promote the existing production worker or reuse
its shared data bindings merely to obtain a faster benchmark.

Local evidence files (not committed payloads):

- `/tmp/rift-startup-mixed-20-20260911.json`, SHA-256
  `3bc43042ccd3726df0e1de16f661a5b0f43abe53452eb6ce04b7299a477da054`.
- `/tmp/rift-startup-mixed-analysis-20260911.json`, SHA-256
  `a074f28b30d5c26e0a5a1701d52ecc00b807bb296bd9ad507f06761c2509d231`.
- `/tmp/rift-startup-mixed-20-20260911.log` retains the admitted run handles and
  bounded scenario evidence. No API keys or access tokens are included.
