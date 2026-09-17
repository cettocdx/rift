# Timestamped Long Task attribution follow-up

Source revision: `6e9557a`. Root collected a Chromium 2400-update representative
mixed-stream profile with the integrated plain-paragraph parser and timestamped
Long Tasks. This report analyzes saved artifacts only. No production performance
change follows from these captures.

An initial `/tmp/rift-longtask-20260913` run overlapped about 8 seconds of a broad
filesystem search during late replay. It is contended, not quiet acceptance.
Its 111ms panel-click task had only 21 samples and an 83.208ms sampling gap, with
13 self samples in transcript-presentation operationStatus. A 74ms task had 35 of 51
samples in Streamdown's block-element J.map callback. These are source leads,
not reliable normal-cost estimates; the elapsed sampling gaps remain unexplained.

The subsequent `/tmp/rift-longtask-quiet-20260913` run had no other coordinated
heavy jobs or native actions. This is a quiet-period statement, not continuous
system-wide isolation. Both markers validated (24/25 samples) with ±0.1975ms
command-latency uncertainty. All five task entries were retained; none dropped.
The replay lasted 61,071ms, with frame maximum 250ms and long-task maximum 259ms.
These are diagnostic observations, not an improvement or regression estimate.

The compact [numeric/source summary](2026-09-13-longtask-summary.json) contains
no DOM snapshots, message content, URLs or provider payloads. Full local artifacts
use the quiet prefix with `.cpuprofile`, `.cpuprofile.js`, `.cpuprofile.js.map`,
`.cpuprofile.correlation.json`, `-timeline.json`, `-result.json`, `-run.log`, and
`-task-findings.json`.

| Task page start | Duration | Samples | Largest sample delta | Source evidence                                                           |
| --------------: | -------: | ------: | -------------------: | ------------------------------------------------------------------------- |
|       52748.4ms |    259ms |     200 |              5.542ms | 180 program;7 resize;6 ResizeObserver callback; other native/rAF samples  |
|       23397.5ms |    101ms |      88 |              1.625ms | 86 program;1 idle;1 requestAnimationFrame                                 |
|       51206.6ms |     96ms |      77 |              1.334ms | All program                                                               |
|       52652.7ms |     94ms |      69 |              9.500ms | 27 Radix Tooltip;23 React renderWithHooks;7 GC;7 Streamdown block mapping |
|       51114.8ms |     75ms |      60 |              1.334ms | All program                                                               |

The 259ms task overlaps a 327.5ms LoAF beginning 52632.3ms. Its 25ms ResizeObserver
script starts 52933.5ms and reports zero forced layout. Resize samples map to
`app/hooks/useMessageScroll.ts:176`, with the observer callback at 336. The much
larger program sample count does not justify assigning 259ms to that hook.

The 94ms scheduler task is a separate task immediately before it, at update 1998.
Its Tooltip samples map to Radix react-tooltip/src/tooltip.tsx:152; the React
samples map to react-dom-client.production.js:4333. Seven samples are in
Streamdown's `J.map` block-element callback (dist chunk-BO 2N 2NFS.js:23:6099).
This confirms some repeated block construction appears in both captures, but
there is no isolated block-construction cost yet. It is not Markdown tokenization.
The profile does not retain React owner identity, so it cannot tell whether
Tooltip belongs to MessageActions or another tooltip in the rendered tree.

## Exact remaining trace requirement

For the predominant program time, the next bounded capture must include a
Chromium main-thread browser trace, not just V8 CPU sampling. Retain browser task
boundaries and rendering phases using `devtools.timeline`, `toplevel`,
`blink.user_timing` and V8/GC events (validate available categories in the installed
Chromium). Include style recalculation, Layout, PrePaint/Paint, layer/composite
work and GC phase durations, and retain User Timing markers outside replay so
trace timestamps can be mapped to the same page-clock task windows. Keep trace
collection and output bounded to one synthetic case; no screenshots, network
bodies or user content are needed.

For each worst Long Task, report which browser phase occupies its interval and
which script invalidated geometry if the trace actually supplies that evidence.
A nearby ResizeObserver or text update is not enough. If layout/paint dominates,
first reproduce its specific trigger and content shape before changing scroll
logic. If React dominates a distinct task, capture component ownership and render
counts for unchanged tool groups/tooltips, then measure a focused candidate.
Tool summary caching must preserve nested output/approval/status changes; tooltip
caching must preserve all state/context/props. Block reuse must preserve renderer
updates, in-progress syntax, paragraph/fence identity and reading anchors.

No extra timing or browser trace was started during this analysis. Root is now
working on a separate concrete mobile viewport issue; future timing needs a new
quiet slot. The evidence does not support a speculative production performance
patch, nor a claim that the existing parser improvement removed all stalls.
