# Preview rendering and mobile copy recovery

Source: `/Users/cetto/RIFT-Release`.

## Reproduced defects

The embedded WorkbenchBrowser preview used an opaque-origin iframe for a
health-verified Vite app. Its HTML returned HTTP 200 while its module scripts
(`/src/main.tsx`, `/@react-refresh`, `/@vite/client`) failed CORS with origin
`null`. The app therefore appeared as a blank white panel despite the preview
server being alive. This was reproduced with the actual saved Brevier preview,
without regenerating the project or rerunning its agent task.

The panel now supplies its health-verified endpoint to WorkbenchBrowser. Only
that separate origin receives `allow-same-origin`, allowing module loading.
Ordinary browser tabs, navigation to a different origin, and RIFT's own origin
retain the opaque-origin sandbox. The change does not grant top navigation or
remove the iframe sandbox. The standalone preview already preserved origins.

Clipboard failures also escaped the preview copy handler. A missing clipboard
API or denied permission now produces a selectable readonly URL with an explicit
Select button. Safari resets selection when tapping an input, so the separate
button is necessary. Copy success is shown only after the browser confirms the
write. Late failures from another conversation cannot display its link in the
current conversation. Opening/dismissing the fallback does not remount the app.

## Verification

- Copy regression before fix: 5 failed, 2 passed.
- Origin regression before fix: 1 failed, 19 passed.
- Latest browser/panel unit run: 47 passed.
- Copy, health and file-download unit run: 34 passed (overlapping suites).
- Mobile tools before origin change: 72 passed, Chromium/WebKit at
  360/390/430px. Covers activity selection, draft/reading preservation,
  reduced viewport, preview navigation/revalidation and terminal download.
- A new cross-origin ES-module browser case uses the real embedded component
  and deliberately omits CORS headers from the fixture module response.
  The fixture no longer replaces WorkbenchBrowser with null in mobile tools.
- Safari's exact warning about unsupported `interactive-widget` is excluded
  from this case's console-error assertion; script/network errors remain checked.
- Actual Brevier page rendered in an isolated Chromium iframe after correction.
- The same real page also rendered inside an isolated WebKit iframe on a
  loopback parent page, with no failed requests. The app-internal browser's
  authenticated panel still remained blank; full end-to-end signoff is pending.
  Follow-up isolation: a plain HTML page on loopback port 3076 with the same
  iframe attributes also stayed empty in Codex's in-app browser, while actual
  Chrome displayed Brevier in that same plain iframe without console errors.
  This separates an in-app-browser-specific behavior from the RIFT component.
  Chrome's RIFT conversation required sign-in, so authenticated Chrome panel
  acceptance has not been claimed.
- Expanded mobile sweep: **77/78 passed**. All six ES-module cases passed.
  The remaining Chromium 390 activity case failed its _initial reading-anchor
  setup_ (520px offset instead of 12px), before opening Activity or streaming.
  This remains a tracked acceptance failure; it is not counted as a pass.
  Three isolated repeats passed without code changes
  (`/tmp/rift-activity-anchor-repeat.log`), indicating a timing-sensitive failure
  still requiring diagnosis rather than a deterministic fix.
- Production build and scoped ESLint passed.

Logs: `/tmp/rift-preview-copy-mobile-regression.log`,
`/tmp/rift-preview-copy-final-unit.log`, `/tmp/rift-preview-origin-red.log`,
`/tmp/rift-preview-origin-green.log`, `/tmp/rift-preview-module-full-browser.log`,
`/tmp/rift-preview-origin-release-build.log`, `/tmp/rift-preview-origin-lint.log`.

## Delivery boundary

The updated immutable build is `.next-ui-release-1789617292246-c358cdc4`, served
locally on port 3074. The main 3057 instance and public domain were not replaced.
No worker was stopped, no unfinished claim was released, and no user's build
task was replayed. These UI checks do not establish physical-phone background
task durability or resolve all provider/subagent failures.
