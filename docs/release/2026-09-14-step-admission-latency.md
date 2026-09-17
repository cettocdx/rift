# Step admission latency — 2026-09-14

Preparation telemetry previously began after the awaited durable ownership marker. It now includes that wait and records it separately. Worker metadata and startup benchmark output expose the first preparation duration and preparation-to-first-chunk interval. The latter includes SDK/network/provider work, not pure provider TTFT. No prompt or credentials are added to telemetry.

The model-step marker now uses Convex HTTP skipQueue. The runner still awaits previous begin/save operations, and awaits this marker before provider work. Server-side owner/claim/run/next-step checks are unchanged. Other checkpoint writes retain ordering.

## Verification

39 focused tests passed (runner checkpoint, checkpoint API, backend checkpoint). Scoped lint passed. TypeScript passed after making the timing field optional for alternate drivers that do not measure this boundary.

Live explanation, same build-codex / medium, one sample per round:

| Round                       | First text | Admission | Ownership wait | After preparation to first chunk |
| --------------------------- | ---------: | --------: | -------------: | -------------------------------: |
| Instrumentation, worker .18 |  51,916 ms | 29,112 ms |       4,121 ms |                         3,682 ms |
| Unqueued marker, worker .20 |   9,774 ms |  3,629 ms |         115 ms |                         2,362 ms |

Both completed and verified with zero duplicate events. Evidence: /tmp/rift-prepare-boundary-20260914.json and /tmp/rift-unqueued-step-20260914.json. Other intervals also changed, so this is not a controlled causal estimate of the queue fix. Under-four-second target remains unmet. No external apps were stopped, no model/effort changes were made. Worker hot reload activated the change; no fresh web bundle was published in this pass.
