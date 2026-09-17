# RIFT performance and recovery quality baseline

Active checkout: `reference-ui`, UI Preview and development worker. This pass establishes repeatable measurement and corrects one confirmed startup dependency. It does not certify the complete product or deploy production.

## Implemented

- `scripts/benchmark-agent-startup.cjs`: repeated authenticated temporary runs, direct durable stream consumption, first event/first text separated from worker first model chunk, explicit disconnect-and-rejoin mode, metadata timings, numeric JSON reports. Default three samples; selectable existing model; bounded sample count.
- `scripts/harness-quality.cjs`: fails missing/failed runs, duplicate events, insufficient samples and slow medians/tails. Initial startup targets: median first text ≤4,000 ms and nearest-rank p95 ≤8,000 ms, at least 20 samples. These are engineering targets, not achieved promises or statistically strong production SLO certification.
- `scripts/verify-harness.cjs`: repeatable type, harness, retained-chat, CLI and quality-validator checks. Can evaluate supplied live reports; it intentionally fails when live latency remains above target.
- `ensureRunTags`: skips tags already attached by the dispatcher using the installed Trigger SDK's server-owned `ctx.run.tags`. Direct/scheduled runs still add missing tags. No ownership, checkpoint, billing, moderation or cancellation checks were removed. The PTY wrapper now retains the SDK run context type instead of narrowing it to only the run ID.

## Measured startup

Same prompt (`merhaba`), Sol, medium effort, temporary worker transport; three sequential development samples per version. Other provider/network variation was not controlled. First text is receipt at the stream consumer, not a browser paint measurement.

| Metric | Before (.22) | After (.23) |
| --- | ---: | ---: |
| Repeated tag HTTP call | 533–619 ms | 0 ms |
| Median worker-start to model request | 3,229 ms | 2,630 ms |
| Median HTTP admission | 2,990 ms | 2,819 ms |
| Median request-to-first text | 10,328 ms | 11,057 ms |
| Sample p95 request-to-first text | 14,430 ms | 11,351 ms |
| Completed with final stream delivery | 3/3 | 3/3 |

The eliminated tag round trip is confirmed. Total first-text latency did not reliably improve; the after median is worse. Three-sample tail differences must not be presented as a proven overall speedup. The quality check correctly remains red for latency and sample count. Next measurements should isolate admission, provider reasoning/prefill and stream-delivery delay without silently changing the selected model or effort.

## Recovery evidence

The direct stream reader detached after its first event and stayed detached until the server reported COMPLETED. Rejoining the same run with its last event ID delivered the finish chunk, zero duplicate events, and visible text. The run completed while detached. Its 17,647 ms first-text value deliberately includes the detached wait and is not a startup benchmark.

In the actual RIFT UI Preview desktop app, a task was submitted to list forty numbers with the final marker `TEST TAMAMLANDI`. The view switched to Studio while the task was running. The Active indicator cleared while Studio remained open. Returning to the same conversation showed the completed response and final marker once. This verifies that this task continued across navigation; it does not measure every transient frame or prove all long-task/network scenarios.

The Codex in-app browser's stale error-document tabs could not be navigated through its URL-policy surface in this session. Native UI Preview was used for the desktop check; no claim of an in-app-browser render audit is made.

## Regression evidence

- Root TypeScript check passed.
- 599 Jest tests passed across 55 suites, including tool policies, ownership, checkpoints, SDK routes, retained sessions and stream replay/reconnect.
- Standalone CLI compilation and 51 CLI tests passed.
- Five quality-validator tests passed: failed/textless samples, insufficient evidence, slow tail, detached completion and configured targets.
- Combined gate: regressions green; disconnect report green; startup report red. Current worker picked up the change; no public deployment.

## Remaining validation

All-model live matrix; repeated persistent-chat tasks; process crash and provider failure injection; prolonged offline/wake behavior; large histories and terminal output; actual key-to-paint, scroll and panel-frame measurements; larger controlled warm/cold latency samples. Passing the checks above is not evidence that these unrun cases pass.
