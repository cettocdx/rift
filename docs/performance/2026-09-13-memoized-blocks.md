# Skip unchanged Markdown block wrappers

Baseline source `de7e918`. Streamdown maps every block on streamed updates. Its
internal Block and RIFT CodeHighlight already memoize rendering, but RIFT's
custom wrapper executed scope setup and standalone fence classification before
those bailouts. Memoizing that wrapper with React's default shallow comparison
skips this redundant work without ignoring changed block/configuration props.

The regression test fails before the change because an unchanged completed block
is classified again. It passes afterward, including changed tail text, incomplete
state changes and edits to earlier content. Existing fence transition tests retain
Wrap and the same `<pre>` when a fence closes. These unit tests supply the parser
boundary; browser replays use the installed Streamdown implementation.

Two 2400-update Chromium CPU-profiled runs used the same 200-message / 60-tool
mixed fixture. Sampled **total self time over the capture**, not per-frame latency:

| Function               |  Before |           After |
| ---------------------- | ------: | --------------: |
| StreamingMarkdownBlock | 307.4ms | no self samples |
| CodeMarkdownBlock      | 163.5ms |          1.25ms |
| standaloneCodeFence    | 199.8ms |          1.29ms |
| CodePresentationScope  | 191.3ms | no self samples |
| previousEmail          | 635.0ms |         628.8ms |

The wrapper work is reduced; autolink parsing remains. Zero self samples does not
mean zero executions. The after run's worst frame was 33.3ms versus 116.7ms before,
but this is one instrumented pair and does not prove a general frame improvement.
The profile now brackets its page-clock origin around CDP start (about 81–84ms
uncertainty in these captures); it does not pretend CPU and page clocks are exact.

Important remaining failures:

- Uninstrumented WebKit mixed/2400 passed interaction assertions, but had five
  frames over 50ms and a 142ms maximum. Scroll smoothness is not fully resolved.
- Uninstrumented WebKit code/600 failed the second disclosure state assertion
  after 5s; its button remained expanded. This intermittent issue was known before
  memoization and is **not resolved** by this change. Two diagnostic repeats passed
  all assertions, with worst frames 80ms and 191ms. Do not erase the failed run.
- Diagnostic timelines now include pointerdown/up targets and disclosure state,
  and failure artifacts include requested state to distinguish misdirected clicks
  from state-update failures when it recurs.

All runs are synthetic renderer/scroll tests, not native, physical mobile,
provider reliability or competitor acceptance. Machine-readable results retain
all successful runs and the failed-run evidence. Eleven targeted tests passed.
