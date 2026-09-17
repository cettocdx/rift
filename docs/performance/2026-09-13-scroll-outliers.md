# Scroll outlier investigation

Correction: the original runs below used literal backslash-n in historical
Markdown, collapsing the intended mixed history into a pathological block. They
are not representative production estimates. The corrected fixture and new run
are documented below; do not compare these as an optimization before/after.

Source: `11018ba`. All original runs used the production message scroll hook and transcript
renderer in the owned synthetic fixture: 200 historical messages, 60 tools,
1200×800 viewport, streaming mixed Markdown, draft typing, panel toggles, wheel
scrolling, and two in-stream tool disclosure toggles. All draft, final-text,
link-identity, scroll-event, disclosure and browser-error assertions passed.

| Engine / instrumentation              | Updates | Duration | Frame p95 | Worst frame | >50ms |
| ------------------------------------- | ------: | -------: | --------: | ----------: | ----: |
| WebKit 26 / timeline                  |    1200 |   31.50s |      19ms |        67ms |     2 |
| Chromium 140 / timeline               |    1200 |   30.86s |    16.7ms |     200.1ms |     1 |
| Chromium 140 / timeline + CPU profile |    1200 |   30.62s |    16.7ms |      16.8ms |     0 |
| Chromium 140 / timeline + CPU profile |    2400 |   61.15s |    16.7ms |      83.3ms |     1 |

The Chromium timeline run captured a 187ms Long Animation Frame containing a
97ms MessagePort callback. The longer CPU-profiled run captured a 103.5ms Long
Animation Frame containing a 102ms React scheduler callback
(`performWorkUntilDeadline`). Neither callback reported forced layout time.
CPU samples near that second interval included Markdown autolink tokenization,
React work and garbage collection. This is a lead, not attribution of the entire
stall: the CPU profile and page timeline do not yet have an explicit shared clock
marker. A repeated profiled run had no outlier. No application optimization or
claim of resolution follows from these inconsistent observations.

The diagnostic now retains Long Animation Frame and script start times,
render/style start times, source function name and source character position;
previously it discarded those fields, making correlation needlessly ambiguous.

These are instrumented diagnostic runs, not acceptance or competitor benchmarks.
WebKit lacks Event Timing and Long Task support here; null values are unavailable
measurements. Frame intervals and Long Animation Frame duration are different
metrics. Native composition, physical touch/keyboard, network failures and
provider errors remain outside this fixture. Next: correlate CPU sampling with
an explicit page-clock marker, then reproduce an identified hot path before
changing its rendering semantics.

## Shared clock and corrected history follow-up

The diagnostic now brackets CDP Performance timeTicks with page performance.now
before and after replay, intersects the offset bounds, and checks CPU samples
inside named 30ms page markers outside measurement. It retains the profile,
source map, anchors, marker validation, and per-LoAF/per-script sample summaries.
The offset bracket measures command latency only; browser timestamp quantization,
sampling gaps and profiler overhead are separate uncertainties. Sample counts
are stack observations, not exact function durations.

An initial aligned run of the old escaped-history case captured a 141ms React
scheduler callback: all 96 samples inside it had Streamdown/remark parsing in
their ancestry. It also captured a 107ms onScroll callback with 66ms reported
forced layout; 50 of 71 samples were in useMessageScroll dimensions(). These
are valid observations of a pathological input, not estimates for normal chat.
The largest sampling gap in the parser window was 23ms.

History now uses actual paragraphs, tables and code fences. The legacy input is
an explicit `RIFT_PERF_HISTORY=escaped` opt-in. A parser regression checks 888
real newlines, 18 fences, 15 tables and over 500 parsed blocks in the live base;
the old base has no real newline and one block. Browser assertions additionally
verify 200 historical headings, 180 live headings, 15 live tables and 18 live
code blocks before replay. Five focused diagnostic tests pass.

One corrected Chromium 140.0.7339.16 run used `optimized mixed 2400`, production
scroll hook, 1200×800 viewport, timeline and CPU profiling. Browser/build/test
work in the other agents was paused; a process check before launch found none.
This was a coordinated quiet period, not continuous system-wide isolation.

| Corrected run                      |         Value |
| ---------------------------------- | ------------: |
| Replay duration                    |      60,951ms |
| Frame p95 / p99                    | 16.8 / 16.8ms |
| Worst frame                        |       166.6ms |
| Frames >50ms / >100ms              |         5 / 2 |
| Long Animation Frames / long tasks |         7 / 5 |
| Longest long task                  |         113ms |
| Event p95                          |          16ms |

All final text, draft, stable-link, disclosure, scroll and browser-error checks
passed. The page-clock offset was 225709766.101ms with a command bracket of
±0.190ms. Before/after named markers contained 22/21 samples, both validated.

At page time 41423.5ms (39.193s after replay start), a 113ms
performWorkUntilDeadline callback contained 75 samples, all under
remark-parse/lib/index.js:32 and Streamdown's block renderer. 68 self samples
mapped to micromark/lib/initialize/text.js:58, with a largest sample delta of
2.667ms; the browser reported zero forced layout in this script. Nearby replay
update 1567 had total text length 54,737; the subsequent mutation changed one
text node. This identifies Markdown parsing during this callback. It does not
identify the exact block from the profile alone or establish why it became an
outlier relative to other updates.

The worst frame overlapped a separate 179.7ms LoAF at page time 43757.8ms:
75 of 86 samples were garbage collection, with a 35.125ms sampling gap. Another
83ms scheduler callback at 44334.4ms had 52 GC samples out of 61. Allocation
sources cannot be inferred from those GC samples. Other intervals included
React scheduling, browser/program time, and a 16ms ResizeObserver callback
with 8 of 10 self samples in useMessageScroll resize() and zero reported forced
layout. No long onScroll forced-layout callback recurred in this corrected run.

Artifacts retained locally under `/tmp/rift-scroll-representative-20260913`:
`-result.json`, `-timeline.json`, `.cpuprofile`, `.cpuprofile.js`,
`.cpuprofile.js.map`, `.cpuprofile.correlation.json`, and `-run.log`.
The earlier pathological artifacts use `/tmp/rift-scroll-clock-20260913`.

## Next bounded investigation

The first target is the active non-fence Block at
app/components/MemoizedMarkdown.tsx:112. Its incremental parser caches raw block
splitting, but Streamdown still parses the changing block's Markdown AST. The
corrected history is realistic block structure; the appended tail deliberately
remains one growing plain paragraph, so this is still a long-paragraph stress
case. First measure that block's content length and parse calls in a focused
real-parser fixture. A conservative plain-paragraph rendering path is a possible
bounded fix only after equivalence tests, including prefixes that turn into GFM
autolinks, links, tables or markup. Preserve final/non-append edits, live-to-final
transitions, local-file links, incomplete-link repair, and code fence DOM identity
and Wrap state. Existing mocked Streamdown performance tests alone cannot prove
parser equivalence. No production change was made here.

Keep the scroll hypothesis secondary until representative reproduction. At
app/hooks/useMessageScroll.ts:213, onScroll reads dimensions before checking a
known programmatic echo; dimensions at line 85 reads client/scroll geometry.
New DOM or text beneath the observed content root invalidates that cached
geometry until ResizeObserver delivery, without needing to observe each child.
Panel width, image/font load, code Wrap, disclosure and viewport/composer changes
can also precede observer delivery. A naive cached-height replacement would
misclassify layout clamping as reader intent. A bounded experiment could
coalesce dirty geometry reads in the prepaint observer path while separately
handling known programmatic echoes, but must preserve pre-observer resize
correction, detached reading anchors, immediate following, upward-wheel cancel,
keyboard scrolling, jump-to-latest, pressed-control hit targets, fence/pre and
content-visibility anchors, and observer cleanup without loops. Existing hook
regressions cover these semantics; actual browser tests must verify event order.

Only one corrected profiled run was taken. Profiling, timeline collection and
Playwright alter execution; no native, physical-input, network or provider
benchmark, distribution estimate, causal allocation claim or resolution claim
follows from it.
