# Browser rendering trace — 13 September 2026

## Outcome and limits

The last capture successfully records Chromium renderer tasks, JavaScript, GC,
style, layout and paint alongside the existing V8 profile and page-clock metrics.
It does **not** reproduce the earlier 250ms frame/259ms Long Task. No production
performance patch or competitor-parity claim follows from this non-reproduction.

This is the existing production-component stress fixture at source revision
`851f2e8`, with diagnostic additions. It runs Chromium 140.0.7339.16 headless at
1200×800, the real chat scroll hook, 200 historical messages, 180 live headings,
15 tables, 18 historical code blocks and 2,400 streamed updates. Typing, scrolling,
panel transitions and disclosures run during the replay. No virtual clock or CPU
throttling is installed. Model calls, authentication, native window composition,
worker transport and physical phone keyboards are outside this fixture.

Other coordinated tests/builds/native interactions were paused during capture.
This is not a claim of continuous whole-machine isolation. Tracing and profiling
add overhead and can change scheduling, so these are diagnostic observations,
not an uninstrumented acceptance score.

## Validated capture

Local artifact prefix: `/tmp/rift-browser-trace3-20260913`.

| Observation                                                   | Result                       |
| ------------------------------------------------------------- | ---------------------------- |
| Measured duration                                             | 60,570ms                     |
| Frame samples                                                 | 3,634                        |
| Frame p95 / p99 / maximum                                     | 16.7 / 16.8 / 16.8ms         |
| Long Task API entries / dropped entries                       | 0 / 0                        |
| Long Animation Frame entries                                  | 0                            |
| Serialized trace                                              | 70,106,221 bytes             |
| Browser-reported data loss                                    | false                        |
| CPU/page clock validation                                     | passed                       |
| Main-thread trace clock markers                               | all four present and aligned |
| Fully contained renderer RunTask events in measurement window | 35,760                       |
| Longest contained RunTask                                     | 10.573ms                     |

The measured page-clock window is approximately 2359.1–62929.1ms; duration is
rounded to milliseconds. A 53.506ms renderer task after that window belongs to
post-measurement checking and must not be relabeled as a replay Long Task.
RunTask trace events and PerformanceObserver Long Task entries are separate
observations, with separate boundaries and thresholds.

The longest contained task partitions into 6.022ms layout, 2.771ms paint,
0.122ms JavaScript, 0.099ms style, 0.389ms compositing and 1.170ms other browser
work. This proves rendering coverage, not a layout defect. Whole-window phase
coverage includes 45,994.841ms untraced time, which is not necessarily idle time;
JavaScript coverage also includes measurement/automation callbacks.
Numeric evidence is retained in `2026-09-13-browser-rendering-summary.json`.

## Capture safeguards and rejected attempts

`scripts/performance/browser-trace.cjs` starts tracing only when the installed
browser supports the requested categories. Native trace storage is bounded to
64MiB with `recordUntilFull`; serialized JSON export is separately capped at
256MiB. Export uses a partial file, only renames on EOF, closes the browser stream,
and bounds completion/reading waits. Existing partial evidence is preserved.
Repeated stop calls share the same promise. The replay saves a metadata sidecar
and rejects unknown/affirmative data loss before allowing attribution.

The first attempt exceeded the initial 64MiB **JSON export** cap. The second
attempt retained a 133,605,928-byte trace but reported data loss and lacked the
two closing markers. Neither is valid for phase attribution. Their corresponding
replay metrics also did not reproduce the previous stalls; they do not prove a
fix. No rejected capture was substituted for the successful one.

Volume inspection showed duplicate `toplevel` task events and verbose invalidation
stacks. The final category list is `devtools.timeline`, `blink.user_timing`, and
`disabled-by-default-devtools.timeline`. The captured categories retain RunTask,
FunctionCall, MinorGC/MajorGC, UpdateLayoutTree, Layout, PrePaint and Paint. Detailed
invalidation stacks can be added to a shorter targeted recording if a reproduced
layout problem needs them; they are not present in this successful trace.

The analyzer verifies all four timing markers against the CPU/page mapping on one
`CrRendererMain` thread. It handles complete X events and synchronous B/E pairs;
clips intervals and partitions exclusive phases rather than summing nested
parents and children. Untraced or ambiguous overlap time is explicit. These
phases describe work inside an interval, not proof of which component caused it.

Protocol references: [CDP Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/)
and [CDP IO](https://chromedevtools.github.io/devtools-protocol/tot/IO/).

## Reproduction

From the release repository, using its supported Node runtime:

```sh
RIFT_PERF_SCROLL=chat \
RIFT_PERF_PROFILE=/tmp/replay-profile.cpuprofile \
RIFT_PERF_TRACE=/tmp/replay-trace.json \
RIFT_PERF_RESULT=/tmp/replay-result.json \
RIFT_PERF_TIMELINE=/tmp/replay-timeline.json \
node scripts/verify-stream-fluidity.cjs optimized mixed 2400

node scripts/performance/analyze-browser-trace.cjs \
  /tmp/replay-trace.json /tmp/replay-profile.cpuprofile \
  /tmp/replay-result.json /tmp/replay-analysis.json /tmp/replay-timeline.json
```

The CLI requires `replay-trace.json.meta.json`; missing completeness metadata,
lost data, wrong thread or invalid alignment rejects attribution. Raw synthetic
traces and bundled source maps stay outside Git. Only numeric summaries and this
methodology are retained in the repository.

## Next verification

The older residual-stall report remains unresolved, not disproved. Capture a
reproducing native/long-session case with this bounded tooling before modifying
scrolling, Markdown semantics or tool summary state. The successful capture adds
rendering visibility and prevents misleading phase attribution; it does not
replace real desktop, mobile and live-provider acceptance tests.
