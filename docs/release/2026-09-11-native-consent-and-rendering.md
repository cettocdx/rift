# Native consent, media accessibility and rendering verification

Follow-up to `2026-09-11-desktop-access-downloads.md`. These results cover the
specific scenarios below; they do not establish full product acceptance or
parity with Cursor, Claude or Codex.

## Native consent and session boundaries

The installed RIFT permission request remained pending with its Allow button
disabled. Sampling the process showed `CFUserNotificationDisplayAlert` waiting
for a response. The installed tauri-plugin-dialog 2.7.1 / rfd 0.16.0 source
selects that system-notification implementation for a parentless message;
supplying the invoking window selects an attached macOS alert sheet.

Attached the invoking Tauri window to computer/local-web permission, writable
workspace consent and browser-open consent. In `/Applications/RIFT UI Preview.app`,
the computer permission sheet now appears in the native accessibility tree.
Cancel returns to the enabled Allow button without granting access. OK returns
to the in-chat macOS permission guidance. Renewing only RIFT's stale macOS Screen
Recording and Accessibility entries with the Applications bundle and reopening
that bundle changed the card to `Computer access is ready`.

A fresh bounded task then completed in the actual application: screenshot,
one Escape key operation, second screenshot. A passive observer on the existing
desktop relay recorded exactly three requests and three successful results;
the screenshot result envelopes contained image data (128,838 and 130,710 JSON
characters), while the key result was 146 characters. The task ended with its
final response after 19 seconds. No other input or file operation was requested.
This proves this one live round trip, not long-task/reconnect acceptance.

After the final web rebuild, reloading the same native webview retained computer
access. A second fresh task checked access and captured one image while the UI
was on Studio. The passive relay observer recorded one successful status response
and one successful screenshot response containing image data (139,266 JSON
characters). The task finished while Studio remained open, and returning to the
chat showed its final response (`Worked for 14s`) with no pending Active entry.
No second native permission prompt appeared. This is a short navigation/reload
acceptance case, not a long-running network interruption test.

The review also found independent session races. Native grant generations now
invalidate late consent and queued input when access is revoked/replaced. Account
sign-out clears file/folder grants, invalidates pending picker results and stops
grant-owned profile terminals. An exact unknown-command fallback revokes existing
grants on older installed shells; those shells still require an update for the
new native generation protection. Other native errors remain failures.

Independent review caught a related hydration regression before commit: the UI
was treating the temporary missing user while authentication loads as sign-out.
The hook now waits for resolved authentication before revoking access or starting
the relay. Regression coverage distinguishes unresolved-to-authenticated reload
from confirmed sign-out, preserving folder grants and their terminals on reload.

Behavioral red/green regressions cover late approval, replacement grants, queued
actions, pending file selection and older-shell command compatibility. The native
library suite passed 46 tests. The app was rebuilt and copied to Applications;
`codesign --verify --deep --strict` passed with an ad-hoc development signature.
Apple distribution signing/notarization remains outstanding. Changing the ad-hoc
signature also requires checking existing macOS permission records again.

## Actual image download

Using the installed app's attachment picker and Image Viewer, selected the local
public brand asset `public/brand/rift-panda-x-icon.png`. No model request or image
generation was used. The viewer's Download control saved the image to Downloads
and displayed its Saved message. Downloading a second time produced
`rift-panda-x-icon (1).png` and preserved the original.

SHA-256 of the source and both downloaded files:

```text
c598b7f2166aa9c5bfea5d9737acc768d854ccba2a774b3d9038bc3806ccbbf8
```

This verifies the native viewer-to-file binary path and filename collision
handling. Remote generated-media URLs, expiration and every media provider still
require their own live acceptance tests.

The same UI exercise exposed that Download/Zoom/Close were outside the element
marked as the modal dialog. The modal now owns the toolbar and canvas, traps Tab
within enabled controls and restores focus to its opener. Six new accessibility
tests plus adjacent media tests passed (11 tests across three suites). Pointer
pan, wheel/double-click zoom and download arguments remain covered.

Native accessibility verification now exposes Download, Zoom and Close within
Image Viewer. Tab focused Download; Shift+Tab wrapped to Close. That live test
also caught a pointer-opener focus gap in macOS WebKit, where clicking a button
does not necessarily focus it. Upload, transcript and sidebar launchers now focus
their triggering button with `preventScroll` before opening. Two real-caller
regressions failed before that fix; 13 tests across four media suites passed after
it. After rebuilding and reloading the Applications app, a pointer click opened
the attachment viewer and Escape returned native accessibility focus to the
`rift-panda-x-icon.png` opener button. The unsent test attachment was removed.

The live desktop run also exposed an inaccurate `Read 3 pages` activity summary.
Screenshots and computer input now use the desktop category and distinct action
labels (`Captured 2 screenshots, sent desktop input` for this run). Readiness,
web reads and file-image labels retain their separate meanings. The presentation
suite passed 71 tests and its component consumers passed 20 tests. The rebuilt
Applications app displays that corrected label for the completed live run.

## Matched streaming replay

The diagnostic timeline correlated 59 ms with mounting 120 output rows and 57 ms
with resizing while those rows were open. Nearby React commits were 0–3 ms.
Offscreen work-detail rows now defer layout with `content-visibility: auto`;
scrolling to the final output is verified to reveal its actual text.

The benchmark now asserts each intended disclosure toggle. Earlier runs with a
missed pointer click are excluded. The matched, uninstrumented replay used a
1200×800 viewport, 200 history rows, 600 updates, eight sustained interactions and
two verified disclosure toggles.

| Metric            | WebKit 26.0, eager details | WebKit 26.0, deferred details |
| ----------------- | -------------------------: | ----------------------------: |
| P95 frame         |                      18 ms |                         19 ms |
| P99 frame         |                      28 ms |                         20 ms |
| Maximum frame     |                      78 ms |                         35 ms |
| Frames over 50 ms |                          3 |                             0 |

Chromium 140.0.7339.16 after the change: maximum 16.8 ms, zero long tasks and zero
frames over 50 ms. Both retained typing, link identity, code and final text.
WebKit does not expose long-task/event-timing metrics in this harness; missing
metrics are not zero. These are component replays, not end-to-end native, provider
latency or competitor benchmarks.

## Mobile browser coverage

`e2e/mobile-fixture` imports the real shared input, popover, scroll hook, file
renderer and Next Image into a loopback-only test server. No production auth or
lab-gate changes were made. Eight tests passed in Chromium and WebKit, including
360/390px transcript widths, touch focus, history, panel transitions and delayed
image decode. The reading anchor stayed within 2px; image frame height remained
300px before/after decode. These fixtures do not cover authenticated application
routes, physical software keyboards or native safe areas.

## Integration checks and open gates

- Final commit-hook Jest: 615 suites, 5,434 tests passed, one existing skipped test;
  24 snapshots. This includes the hydration, action-label and pointer-focus fixes.
- TypeScript, lint, desktop source/config tests and release web build passed.
- Complete screenshot → one Escape → fresh screenshot passed in the Applications bundle.
- Long-task reconnect and cross-session native acceptance remain separate gates.
- Physical mobile and authenticated all-route acceptance remain open.
- Full production readiness and the planned landing replacement remain open.
