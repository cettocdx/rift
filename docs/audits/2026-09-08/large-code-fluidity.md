# Large-code rendering and malformed-link resilience

2026-09-08 · RIFT UI Preview · `codex/reference-ui-rebuild`

## Reproduced issues

| Before | After | Why |
| --- | --- | --- |
| A growing, syntax-highlighted 1,800-line code block produced 23,267 elements in the live transcript. | 1,665 elements; code blocks exceeding 32,000 characters or 400 lines display their complete source in plain monospace. | Token decoration must not monopolize the UI thread. Copy, download and wrap retain the complete source. Small samples retain highlighting. |
| `decodeURIComponent` during link rendering threw `URIError` for incomplete `%` escapes and literal-percent filenames. | Invalid encodings preserve the supplied path; valid encodings decode once. | An unfinished model-generated link must not take down the conversation. No path is guessed and no file is opened automatically. |

The code budget counts characters first and scans at most 32,000 characters for line breaks. It does not split or tokenize the entire large source. Once over budget, subsequent deltas update the same plain code node. Replacing it with a small source restores highlighting.

## Controlled before/after replay

`node scripts/verify-stream-fluidity.cjs optimized code 600`

Production React and real Markdown/code components in Chromium 140.0.7339.16 at 1200×800. Two sequential runs on the same machine; no production build was running during either replay. Each streams 600 updates at a requested 25 ms interval, adding three TypeScript lines per update, with 200 history rows, 60 tool events, 60 reasoning entries, concurrent typing and panel interactions. Provider/worker traffic is synthetic and external requests are blocked.

| Metric | Before | After |
| --- | ---: | ---: |
| Measured replay duration | 43,022 ms | 20,899 ms |
| RAF interval p95 | 133.4 ms | 33.2 ms |
| Maximum RAF gap | 200 ms | 83.4 ms |
| Observed long tasks | 165 | 0 |
| Maximum long task | 200 ms | 0 ms |
| Observed interaction-event p95 | 88 ms | 32 ms |
| Live transcript elements | 23,267 | 1,665 |

Both runs preserved the exact typed draft, original Markdown link node and final code line. No page errors. Different run durations naturally resulted in different interaction cycle/sample counts; raw JSON reports are adjacent. This is not an LLM latency benchmark, official INP measurement, native WebView trace or competitor parity result. The replay panel is synthetic and retains its existing width animation. The 83 ms outlier remains unexplained by this aggregate trace.

## Validation

- Before the fixes: two large-code regressions failed; four malformed-link regressions failed with `URIError`.
- After: 36 tests across eight suites passed. Covered large/minified/many-short-line code, full-source copying, wrap/node continuity, valid/invalid link updates, real AI SDK reader-finalizer ordering, reconnect recovery, duplicate-response prevention and lazy-panel draft preservation.
- Next production build passed, including TypeScript, into `.next-code-fluidity-release`. No running frontend or worker was restarted.
- A post-build 1,200-update / 3,600-line replay completed in 50,311 ms with zero observed long tasks, frame p95 33.4 ms, maximum frame gap 100.1 ms and observed event p95 40 ms. All 24 sustained interaction cycles preserved the draft and final code; live DOM remained at 1,665 elements. This establishes bounded decoration growth, not zero jank.

## Rollout and limits

The source changes apply to the 3020 UI Preview. The existing 3022 server and running workers were not stopped or retried. Existing account permissions were not changed. Native interaction checks on an in-use window were not forced past the app-state-change guard.

These fixes address two reproducible UI defects. They do not guarantee uninterrupted external providers, repair every runtime error, or establish Cursor/Claude/Codex equivalence.

## Repeatable comparison

The script now also accepts `unbounded-code code 600`: it removes the code budget only from the isolated temporary bundle and leaves source files and running services untouched. Use it against `optimized code 600` on the same machine for a fresh comparison. `node --check` passed; the recorded before run above was captured before the production patch, not from this later reproduction switch.
