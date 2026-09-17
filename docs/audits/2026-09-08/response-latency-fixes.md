# Response latency investigation — 8 September 2026

Applied to the reference-ui checkout and live UI Preview development worker. No public deployment. Existing model selection and reasoning effort preserved.

## Measured causes and changes

- A fresh Build greeting already omitted tools, but still sent the complete Build manual. The validated greeting path now uses a short greeting prompt, retaining model identity, user language, saved user preferences and temporary-chat context. Actual system input fell from 4,097 to 760 tokens for the test account. Normal requests, history, attachments, project/profile context and continuations retain the complete workflow. Responses still come from the selected model.
- `createAgentStream` probed local PTY capability even with zero tools (twice before first provider output). It now probes only if `interact_terminal_session` can be offered. Greeting turns also skip local sandbox context acquisition, so a local runner need not connect to answer a greeting. PTY filtering remains active when needed.
- Free-tier concurrency admission and billing configuration read the same balance consecutively. Configuration now accepts the already server-loaded, request-scoped snapshot. No client balance is trusted; atomic reservations, suspension checks, moderation and checkpoint ownership remain unchanged. Team funding still uses its own query. The live test account is paid, so this free-tier saving is covered by tests, not the paid-account timing comparison.
- Added first-visible-model-text telemetry distinct from reasoning/tool chunks. The benchmark compares that time with client receipt. Telemetry contains timings and token counts, never prompts or response contents. The delivery delta assumes the local worker and probe share a clock; do not use it across unsynchronized hosts.

## Live comparison

Fresh temporary `merhaba` requests, GPT-5.6 Sol selection, medium effort, same machine and `/api/agent-long` transport. Three sequential samples per version; provider and network variation not controlled. This is exploratory evidence, not a statistically validated p95 or all-model result. First text means durable-stream consumer receipt, not browser paint.

| Metric | Before (.25) | Final (.28) |
| --- | ---: | ---: |
| First-text samples | 15,911 / 8,239 / 10,116 ms | 6,688 / 6,486 / 11,197 ms |
| Median first text | 10,116 ms | 6,688 ms |
| Median worker preparation | 2,282 ms | 1,678 ms |
| Median model text → consumer | 508 ms | 242 ms |
| System prompt tokens | 4,097 | 760 |
| Completion / duplicate stream events | 3/3 / 0 | 3/3 / 0 |

The middle version (.26) measured 7,691 / 6,609 / 8,983 ms. All nine startup samples completed. The final slow sample spent 5,535 ms in HTTP admission alone. The first-text median decreased about 34% in this small comparison; tail latency remains unacceptable and the ≤4-second startup target is NOT met. Do not attribute the entire observed improvement to one code change or promise this improvement for complex Build tasks.

Raw timing-only evidence: `latency-before.json`, `latency-prompt-pass.json`, `latency-after.json` in this directory.

## Verification

- New tests failed before changes and passed afterward for first-text reporting, omitted PTY connection, greeting prompt and balance snapshot reuse.
- Root TypeScript check and CLI compilation passed.
- Harness gate: 602 tests across 55 Jest suites, 51 CLI tests, five quality-checker tests passed.
- Focused prompt, greeting, loop and billing suites: 108 tests passed (some overlap the gate).
- Broader prompt snapshot check: 16 passed, eight existing Security-mode snapshots fail because they lack the pre-existing task_scope section. The diff is unrelated to this pass; snapshots were not overwritten to conceal it.

## Disconnect check

On the final worker, the reader disconnected after its first event, waited until the task completed, then rejoined the same run with its event cursor. The task completed while detached; text and finish arrived with zero duplicate events. The 14,640 ms first-text observation and 4,506 ms delivery delta intentionally include the detached wait and must not be used as ordinary latency samples. Evidence: `latency-recovery.json`.

## Remaining work

HTTP admission and dispatch latency, model/network variability, persistent-chat warm/cold samples, all-model matrix and actual UI paint measurements. No claim of a fully fast or flawless app.
