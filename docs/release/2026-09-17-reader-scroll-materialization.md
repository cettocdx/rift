# Reader scroll and skipped-history materialization

The previous mobile sweep failed one reading-anchor setup before opening
Activity. Three repeats passed, so the failure was kept open rather than
declared fixed. Inspection found a deterministic scroll-owner defect:
`useMessageScroll.onScroll` treated every `scrollHeight` change as layout-only
and restored the previous anchor. Scrolling into `content-visibility: auto`
history can materialize rows and change that height before the scroll event.
The handler could therefore undo actual reader movement.

Regression tests reproduced this with and without a wheel event: a reader
position of 300 was restored to 380. The handler now distinguishes an unchanged
viewport plus a new scroll position from its own scroll placement and browser
clamping. Viewport resizes still retain the old semantic anchor. Reader movement
captures a new anchor and does not re-enable follow unless the reader reaches
the bottom. A scrollbar jump from following mode is covered too.

Validation receipts:

- Before correction: 2 failed, 26 passed.
- After correction: 29 passed, including content growth, viewport narrowing,
  keyboard interruption, clamp behavior, restored routes, hidden surfaces,
  pressed controls, and bounded anchor measurements.
- Scoped lint passed; no new timer, animation, or network request was added.
- The first corrected-code sweep was 77/78: a preview test still failed its
  setup by exactly 520.515625px. Separately from the hook defect, that setup
  measured a descendant of a skipped row. It now brings the target into view
  before assigning a precise within-row position. The 2px assertions and all
  subsequent streaming/panel preservation checks remain unchanged.
- Final mobile tools sweep: 78/78 passed across Chromium and WebKit after
  both the production hook correction and the independent fixture correction.
- Transcript suite completed: 72 passed, 16 skipped. The skips are explicit
  platform exclusions: zero-height mobile question dock cases on desktop and
  bounded desktop dock integration on mobile. No new skip was introduced.
- Activity and preview touch/reading preservation at Chromium 390 repeated
  five times each: 10/10 passed after rendering the target before setup.

Logs: `/tmp/rift-reader-scroll-red.log`,
`/tmp/rift-reader-scroll-final-unit.log`, `/tmp/rift-reader-scroll-lint.log`,
`/tmp/rift-reader-scroll-mobile.log`,
`/tmp/rift-reader-scroll-mobile-final.log`,
`/tmp/rift-reader-scroll-transcript.log`,
`/tmp/rift-reader-anchor-materialized-repeat.log`.

This is a shared web transcript correction, not proof of native iOS behavior,
worker durability or successful provider execution.

Production build completed with exit 0 (`/tmp/rift-reader-scroll-release-build.log`).
The immutable output `.next-ui-release-1789618208753-fad51adb` is running separately
on port 3075. The authenticated saved Brevier conversation opened there with its
transcript, final response and three completed collaborator results intact.
Main web and worker processes were not restarted; no public release was promoted.
This check does not resolve the separately documented in-app-browser iframe issue
or establish live worker durability.
