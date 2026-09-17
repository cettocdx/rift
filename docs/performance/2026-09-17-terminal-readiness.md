# Terminal preparation: telemetry and cancellation

The non-interactive terminal path called a health helper before dispatching the
user's command. That helper awaited a resource-metrics request before its actual
`echo ready` probe, and fetched metrics again when the probe failed. Optional
telemetry could therefore stall a healthy command or delay a permanent error.

Readiness now checks running status and the real command probe without fetching
resource telemetry. Original SDK errors remain intact. Both SDK requests carry
the caller's abort signal and a five-second request timeout; cancellation is
checked between phases and after probe completion.

The shared backoff helper also retried an AbortError three times when no separate
signal was supplied, and could install a timer after cancellation during a
failed attempt. It now propagates cancellation immediately and removes its
timer/listener on cancellation or completion. No user command is replayed by
these changes; this retry helper is used for the harmless readiness probe.

## Evidence

- Seven of eight new regressions failed before the changes. They reproduce
  indefinitely pending telemetry, an obscured authentication error, Stop during
  status/probe work, and cancellation during backoff. The existing transient
  recovery case passed before and after.
- The new suites plus the terminal command suite pass: **55 tests**. Full
  TypeScript, scoped ESLint and whitespace checks pass.
- A real, separately created E2B sandbox ran six alternating baseline/current
  readiness samples, after one warm-up command. No files, scans or model calls
  were involved. Baseline: 1473 / 1271 / 866ms; current: 1045 / 523 / 483ms.
  Median preparation time was **1271ms → 523ms**. Three samples per path are a
  small diagnostic sample, not a latency SLO, cold-start distribution or the
  complete first-response time.
- Cleanup killed only the owned canary and verified it was no longer running.

Logs: `/tmp/rift-readiness-red.log`, `/tmp/rift-readiness-green.log`,
`/tmp/rift-readiness-lint.log`, `/tmp/rift-readiness-typecheck.log`.
Live receipt: `/tmp/rift-readiness-live-0917.json`.

The hosted worker's end-to-end long task acceptance still requires the pending
ordinary QA verification. These checks do not establish durable task completion,
production rollout, or freedom from external-provider failures.

## Verified artifacts

The production frontend/server build passed and is served separately on 3079:
`.next-ui-release-1789621661596-8441a818`. Its login endpoint returned HTTP 200.
Build log: `/tmp/rift-readiness-release-build.log`.

Hosted staging version `20260917.5` passed the Linux build/index/deploy pipeline.
The deployment API confirms exactly `agent-long` and `hack-long`; staging still
has zero schedules. `/tmp/rift-readiness-hosted-manifest.json` records the
deployment identity and hash. The separate 3078 canary API has the same changed
readiness files and is pinned to this version. The main application and its
existing worker were not restarted or promoted for this update.
