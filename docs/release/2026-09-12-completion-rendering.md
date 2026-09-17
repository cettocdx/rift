# Completion rendering and late usage receipts

Baseline: `7a5f85b`. The preceding dock test found a completion-time RAF gap,
but did not identify its cause. This follow-up separates render work from
Markdown parsing, highlighting and Activity updates.

## Attribution

An opt-in fixture mode wraps the actual Messages and Activity components in
React Profilers. Guarded fixture-only transformations count calls through the
real web-source extractor, incremental Markdown parser and installed Shiki
highlighting path. No production profiling API or replacement renderer is added.
Development React is required for attribution; these are not production latency
or native WKWebView benchmarks.

Two WebKit cases use 36 completed user/assistant pairs, three actual highlighted
code blocks, a held message-reference snapshot and an unsent draft. After
highlighting completes, an unchanged-status checkpoint precedes completion.
Activity either stays ready or follows the real global status. Both baseline
cases passed full-source and painted-anchor checks.

Completion performed 37 source extractions, zero Markdown parses, and zero Shiki
jobs/renders. The main Messages commit took 18–20ms; Activity contributed 0–1ms.
This disproves mass re-highlighting as the explanation in this specific workload.
It does not establish the cause of the earlier 309ms gap, and the fixture does
not emulate final server metadata or deliverable-card arrival.

## Change

`Messages` now passes live status, finish reason, summarization and loading
notice props only to the latest assistant row. Historical rows keep ready/null
values. Existing positional flags remain unchanged, including when the newest
message is a user row. Historical errors and denied actions stay encoded in
their parts; copy, edit, feedback and branch remain available. Regenerate is a
latest-assistant-only control and continues following the live status.

In addition, `MessageItem` now invalidates its memo when exact `totalTokens` or
`costDollars` metadata changes. Previously a receipt arriving after text and
duration, with unchanged parts, did not update the visible figures. This changes
display correctness, not billing arithmetic or credit deduction. Independent
token corrections and zero-cost corrections remain visible.

The real Messages/MessageItem/MessageActions unit regression first failed for
historical extraction and missing late receipts. It verifies submitted,
streaming, error and ready controls, historical editing/branching, and metadata
updates without text/status changes. Browser source/anchor checks are separate
from the unit renderer's mocked media and part boundaries.

## Exact post-change comparison

Both WebKit attribution cases passed again with unchanged diagnostic code.
Source extractions fell from 37 to 1; the main Messages commit was about 1ms in
both cases. Markdown/Shiki counters remained zero. The recorded completion RAF
maxima changed from 51/49ms to 20/19ms. Full code, painted anchor and draft were
preserved. This is one ordered development comparison, not a universal speedup
or a claim of Cursor/Claude parity. Native, route-remount and real final-metadata
profiling remain separate work.

Raw evidence: `/tmp/rift-completion-attribution-evidence` (baseline, postfix,
comparison and instrumentation notes). Normal actual-dock correctness tests are
also run with profiling transformations disabled before release verification.

The maintained diagnostic is runnable from any checkout with
`pnpm exec playwright test --config e2e/mobile-fixture/playwright.completion-profile.config.ts`.
It uses isolated loopback port 3039 and writes ignored fixture results. Run it
without simultaneous builds/tests; do not interpret development measurements as
optimized-release benchmarks.
