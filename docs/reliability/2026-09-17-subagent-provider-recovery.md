# Subagent provider recovery

The delegated specialist loop explicitly set `maxRetries: 0`. A single retryable provider error after a successful read therefore ended the delegate, even when the request could be retried without re-running that read.

The loop now permits two SDK retries per failed model request. The installed SDK applies this retry inside the current generation step, before tool execution; it does not restart `generateText` or the specialist's full task. Completed tool messages remain in the next request. Permanent rejection, structured-output validation, and cancellation do not trigger this retry path. This retry count is not a limit on agent steps, tokens, cost, or task duration.

Failed results now persist an allowlisted category, HTTP status when available, and attempt count. SDK retry wrappers are unwrapped to the final provider error. Invalid structured output is distinguished from provider rejection. The parent receives the already collected evidence and a specific failure explanation. A correlated structured event includes agent/model/request IDs and counts, but excludes provider bodies, prompts, raw result text and stack traces.

## Evidence

- Three new real-SDK regression tests failed before the change: a transient 503 ended the task, exhausted retry behavior never retried, and permanent failure had no category.
- Final four-suite run: **41 tests passed**, including transient recovery after a read, exactly one read dispatch, two distinct successful usage receipts without duplicate recording, permanent 401 without retry, exhausted 503 retries preserving evidence, Stop during backoff, and invalid structured-output classification.
- Full TypeScript `tsc --noEmit --incremental false` and scoped ESLint passed. `git diff --check` passed.
- Logs: `/tmp/rift-delegate-retry-red.log`, `/tmp/rift-delegate-final.log`, `/tmp/rift-delegate-types.log`, `/tmp/rift-delegate-lint.log`.

These tests use the installed AI SDK with a controlled provider, not a paid production generation. The video's historical generic failure does not contain enough metadata to prove it was a 503; this fixes a reproducible failure path and makes subsequent failures diagnosable without inventing a historical cause.

## Deployment

Source change only at this stage. The already running 3060 UI release predates this backend change. Main web/Trigger worker have not been restarted. A fresh read-only web maintenance check again failed to establish safe restart (`/tmp/rift-web-maintenance-after-mobile.log`); no active or unknown producer was killed and no claim was forcibly released. Hosted worker rollout and live task acceptance remain open.
