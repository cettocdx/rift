# Streaming interaction follow-up — 2026-09-13

Application source: `75594d5`; test coverage change accompanies this report.

The earlier intermittent disclosure timeout could not be reconstructed from its
old temporary diagnostic file (no longer present). It did not recur in today's
long-text replay. This does **not** establish that the intermittent issue is fixed.

The code scenario previously omitted the disclosure checks entirely. It now
opens/closes the real AssistantTranscript tool group during streaming and, after
streaming, checks that all 120 synthetic evidence blocks are mounted, the last
block is visible and readable, and closing removes the blocks. Both scenarios
use the production useMessageScroll hook, 200 historical messages, and 60 tools.

| WebKit 26, 1200 × 800      | Updates | Duration | Interaction loops | p95 frame | Worst frame | >50 ms |
| -------------------------- | ------: | -------: | ----------------: | --------: | ----------: | -----: |
| Mixed text                 |    2400 |  62.08 s |                38 |     21 ms |       87 ms |      1 |
| Growing code + disclosures |     600 |  16.16 s |                 8 |     21 ms |       48 ms |      0 |

Each performed two in-stream disclosure toggles. Draft contents, final output,
link identity, actual scroll events and browser-error assertions passed. The code
case contains 1800 generated code lines. Machine-readable results are alongside
this report. These are individual runs, not percentile estimates across runs.
The 87 ms outlier remains outside a smooth 60 Hz frame budget.

Reproduce from the repository root:

```sh
RIFT_PERF_SCROLL=chat RIFT_PERF_ENGINE=webkit node scripts/verify-stream-fluidity.cjs optimized mixed 2400
RIFT_PERF_SCROLL=chat RIFT_PERF_ENGINE=webkit node scripts/verify-stream-fluidity.cjs optimized code 600
```

This isolates rendering and interaction: it does not measure model latency,
network reconnection, native window compositing, physical mobile input, or
Cursor/Claude parity. Long tasks and Event Timing are unavailable in this WebKit
run; their null values must not be treated as zero latency. Further work should
retain the intermittent-timeout diagnostic path and investigate remaining frame
outliers under native and longer-running workloads.
