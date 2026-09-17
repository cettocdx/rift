# Focused active-paragraph parser diagnostic

This follows the corrected mixed-history profile in
[scroll-outliers](2026-09-13-scroll-outliers.md). That run captured a 113ms
Streamdown/remark callback, but did not identify the individual block. This
focused diagnostic captures actual Streamdown Block props after remend and block
splitting, then measures that active paragraph in isolation. The successful
differential comparison was followed by integration into MemoizedMarkdown and
the browser replay documented below.

## Method and scope

`NODE_ENV=production node scripts/performance/measure-paragraph-parser.mjs
/tmp/rift-paragraph-parser-production-20260913.json` ran once in a coordinated
quiet slot with other agents' heavy work paused. Node v22.23.1, installed
Streamdown 2.5.0, remark-parse 11.0.0 and remend 1.3.0. An earlier exploratory
Node run omitted NODE_ENV and used React development SSR; its numbers are not
used below. Artifacts remain at `/tmp/rift-paragraph-parser-production-20260913.json`
and `.log`; the development artifact is `/tmp/rift-paragraph-parser-20260913.json`.

The normal processor uses the plugins captured from actual Streamdown, matching
its `Ct/ks` pipeline: remark-parse, default remark plugins, remark-rehype with
allowDangerousHtml, then default rehype plugins. The candidate uses the
`lib/ui/plain-paragraph-parser.ts` plugin after the same remark plugins. Actual
exported Block SSR and full Streamdown rendering are also checked; there is no
mocked parser or direct paragraph rendering replacement.

Each checkpoint has 15 alternated normal/candidate measurements after warmup.
A second bounded window measures each distinct append from update 1500 through
1567 once. The active tail is intentionally a growing plain paragraph:
`Latest result: ` followed by repeated `Streaming output. `. All checkpoints
retain 592 actual parsed blocks from the corrected mixed history. These are
Node microbenchmarks, not browser frames, native timing, or live provider data.

## Production-mode results

All times below are medians in milliseconds. Pipeline includes parsing and
remark/rehype transforms; Block SSR also includes React rendering.

| Updates | Active UTF-16 units | Parse normal / candidate | Pipeline normal / candidate | Block SSR normal / candidate |
| ------- | ------------------: | -----------------------: | --------------------------: | ---------------------------: |
| 1       |                  32 |            0.049 / 0.050 |               0.087 / 0.095 |                0.117 / 0.118 |
| 64      |               1,166 |            0.241 / 0.002 |               0.260 / 0.028 |                0.283 / 0.054 |
| 256     |               4,622 |            0.755 / 0.005 |               0.794 / 0.034 |                0.826 / 0.067 |
| 512     |               9,230 |            1.627 / 0.009 |               1.656 / 0.042 |                1.514 / 0.077 |
| 1024    |              18,446 |            3.027 / 0.017 |               3.189 / 0.053 |                3.246 / 0.090 |
| 1567    |              28,220 |            4.664 / 0.027 |               4.751 / 0.065 |                4.846 / 0.114 |
| 2400    |              43,214 |            8.168 / 0.035 |               8.045 / 0.088 |                8.096 / 0.144 |

The growing 1500–1567 window (68 distinct active paragraphs) had normal/candidate
Block SSR median 4.936/0.115ms, p95 5.350/0.172ms and maximum 5.706/0.232ms.
Whole-message remend remains unchanged: median 0.613ms at update 1567 and 0.778ms
at update 2400. This isolates a material saving in ordinary long-paragraph
parsing; it does not establish that the prior 113ms browser outlier or GC stalls
are eliminated. There was no browser DOM, layout, observer, or input workload in
this focused timing.

## Eligibility and semantic evidence

Five diagnostic tests exercise the installed pipeline and production
helper. Tests compare exact mdast including positions, transformed HAST, actual
Block HTML, and full Streamdown HTML in streaming/static modes. The long custom
`components.p` test serializes its received HAST node and checks undefined/ltr/rtl
direction, so those checks exercise the admitted path above 1024 characters.

The bounded domain is at least 1024 UTF-16 units:
start with a Unicode letter, then only Unicode letters/marks/numbers and ASCII
space plus `. , ! ? : ;`. Reject `www.` case-insensitively anywhere. GFM recognizes
that literal as a link without requiring slash or `@`; partial `www` can remain
plain, but a following dot must immediately fall back. HTTP links, email,
entities, escapes, HTML, emphasis, code, lists, tables, quotes, tabs, NBSP, joiners,
line separators and all other characters remain on the existing parser.

The guard must use a strict end assertion: JavaScript `$` alone accepts a final
newline. Review found that hole in the first helper version; it was corrected
before the measurements. LF/CR/CRLF/U+2028/U+2029 regressions now compare against
the real parser. Eligible trailing ASCII spaces are trimmed only from the text
node's value/end position; paragraph/root end positions retain the full input
length. Surrogate-pair letters and combining marks use UTF-16 offsets, matching
the installed parser. Cases include Arabic/Hebrew, NFD accents, astral letters,
variation marks and Unicode numbers. This corpus supports the narrow Unicode
allowlist; it is not an exhaustive proof for every Unicode sequence.

Keep the shortcut inside remark parsing, after Streamdown's existing remend and
block splitting. Remend can trim trailing spaces, close emphasis/links, or trim
partial HTML before the Block receives text. Raw-input bypass would change that
behavior. Preserve the existing Block, remark/rehype transforms, sanitization,
custom renderers, direction wrapper and component ancestry. Re-evaluate every
new string and fall back immediately when append/edit/finalization introduces
syntax. Do not enable the shortcut generically for custom syntax plugins that
assign meaning to otherwise plain characters without new equivalence tests.

## Files and validation

- `scripts/performance/paragraph-parser.mjs`: real Streamdown capture and pipeline helpers.
- `scripts/performance/measure-paragraph-parser.mjs`: bounded append/cost diagnostic.
- `scripts/__tests__/paragraph-parser.test.mjs`: real-parser differential and rendering checks.

`NODE_ENV=production node --test scripts/__tests__/paragraph-parser.test.mjs`
passes five tests. Root owns production helper/integration and broader tests.
No service restart, provider request or commit was made by this task.

## Integrated Chromium follow-up

Root then ran the integrated plugin in one corrected mixed-history Chromium
profile, with 2400 updates, the same 200 historical messages,180 live headings,
15 tables and 18 code blocks. The saved `/tmp/rift-plain-after-20260913` artifacts
include `.cpuprofile`, `.cpuprofile.js`, `.cpuprofile.js.map`,
`.cpuprofile.correlation.json`, `-timeline.json`, `-result.json` and `-run.log`.
This follow-up analyzed those saved files only; no additional timing run was
started. A compact source-map/ancestry comparison is retained in
`/tmp/rift-plain-after-20260913-parser-findings.json`.

Both clock markers validated (22 before,20 after samples), with a ±0.150ms
command-latency bracket. Replay lasted 61,198ms. All final text, draft, stable
link, disclosure, scroll and error checks passed. Frame p95/p99 remained 16.8ms;
maximum was 166.7ms versus 166.6ms in the corrected prior run. Both had 5 frames
above 50ms; this run had 3 above 100ms versus 2 previously. It reported 7 LoAFs,
6 long tasks and a 119ms long-task maximum. These single instrumented runs do
not demonstrate improved overall frame latency or outlier elimination.

Within the seven retained after-run LoAF windows, none of the sampled stacks
had remark-parse or the shortcut helper in their ancestry. In the prior run,
the 115.5ms LoAF at page 41421.8ms contained 75 remark-parse samples out of 77,
including all 75 samples inside its 113ms scheduler callback. The after-run
absence is a sampled observation consistent with the isolated parser saving;
it does not mean that no Markdown parsing occurred elsewhere or prove all
remaining stalls have a new cause.

The longest retained scheduler callback began at page 32238.1ms and lasted 57ms,
inside a 158.4ms LoAF. Its 41 samples were spread across React rendering/commit,
fixture App, input updates, MessageActions/date formatting and transcript
summary work. Source maps identify `MessageActions.tsx:113` (9 inclusive samples,
2 self), `lib/utils/message-time.ts:8` (2 self), and React `updateInput`
(4 self); none alone explains the whole callback. The whole LoAF had 64 of 114
samples in `(program)`, with a 5.125ms maximum sample gap. This is insufficient
to assign the entire 158.4ms to React or any one application function. Nearby
update 1190 had 47,951 total text units and a fixture commit interval of 48.6ms.

Other supported observations: the 62.4ms LoAF at 33122.9ms had 37 of 43 samples
in GC; allocation sources remain unidentified. Scheduler scripts at 32428.6ms
(10ms) and 47351.7ms (9ms) each had 6 self samples in React setTextContent.
A 5ms ResizeObserver callback at 32500.7ms had 3 samples under
`useMessageScroll.ts:176` resize/getBoundingClientRect. All retained script
entries reported zero forced layout. Two short rAF callbacks and a 13ms
PerformanceObserver callback belong to diagnostic collection. Several longer
LoAFs were dominated by `(program)` samples, which do not provide a JavaScript
source attribution. The old pathological scroll-layout stall did not recur.

The 119ms Long Task cannot be assigned a stack from these artifacts: the
collector retained its maximum duration but discarded individual Long Task
start times. No retained LoAF script has that duration, and Long Tasks and
LoAF scripts are different intervals. The diagnostic now additionally saves
`longTaskEntries` with only numeric startTime/duration (latest 1000 entries) and
`longTaskEntriesDropped` in results, which are also nested in the timeline.
Existing long-task count/max remain unchanged and unsupported-browser values
remain null. Syntax and diff checks pass. This collection change was not used
to retroactively label the 119ms task, and no rerun was made for it.

## Integration acceptance

MemoizedMarkdown installs the shortcut after Streamdown's default remark
plugins, keeping the same Block and downstream rendering pipeline. No buffering,
typing animation, truncation or direct `<p>` renderer was introduced. The
pipeline is scoped to the installed defaults; adding syntax/fromMarkdown
extensions requires revalidating or disabling the shortcut.

The real transcript browser fixture passed eight Chromium/WebKit cases across
360/390/430px and desktop. They grow a short paragraph beyond the threshold,
append links and emphasis, recognize a `www` autolink, replace the answer and
finish streaming while retaining the same paragraph DOM node. Sixteen existing
browser cases also passed for small/large code-fence closure, Wrap and reading
anchors. Initial new-test failures were incorrect expectations of an HTML
`strong` tag (the library uses a marked span) and a slashless normalized URL;
production rendering was correct and those assertions were corrected.

Three focused component suites passed 16 tests, and five independent real-parser
suites passed in production mode. TypeScript passed. The full release hook and
production build remain separate gates; these checks do not prove physical
mobile input, live-provider response time or competitor parity.

## Timestamped follow-up

The subsequent [Long Task attribution report](2026-09-13-longtask-attribution.md)
records a contended diagnostic and a fresh quiet capture with individual task
timestamps. Most of the longest task is browser/native work rather than an
attributable JavaScript stack; browser rendering traces remain necessary.
