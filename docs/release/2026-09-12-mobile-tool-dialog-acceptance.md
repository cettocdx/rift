# Mobile Activity / Preview dismissal

The production mobile modal hid Radix's close control while the inner panels
also omitted a close control. On a phone, the desktop workspace toggle is
outside the modal and inert, leaving no touch dismissal.

`MobileToolDialog` now keeps a 44px close button in a visible, safe-area-aware
header. The actual panel roots are contained below it instead of covering it
with viewport-fixed positioning. Closing restores the prior focus without
scrolling the underlying conversation. Existing focus trapping and background
isolation remain in place.

## Reproduction and coverage

Run `pnpm exec playwright test --config=e2e/mobile-fixture/playwright.mobile-tools.config.ts`.
This dedicated fixture runs on port 3045 and refuses to reuse another server.
It uses the real MobileToolDialog, ComputerSidebarBase, BuildPreviewPanel,
Messages and composer with a long transcript and sustained local output.

For both Activity and Preview, at 360, 390 and 430px in Chromium and WebKit:

- Verify the close control is at least 44px, visible and hit-testable.
- Verify the panel is below the close control and inside the viewport.
- Confirm output advances while the modal is open.
- Dismiss by touch and verify draft preservation, prior-focus restoration,
  removal of background inertness and less than 2px reading-anchor drift.
- Wait for the stream to complete; reject page errors and service attempts.

WebKit touch does not focus buttons like Chromium. The test records the actual
focus before opening and checks its restoration rather than assuming the
opener became focused. The controlled stream lasts longer than the default
5-second assertion timeout; completion has an explicit 15-second allowance.

## Limits

This is a browser component integration test with service boundaries stubbed.
Preview exercises the real panel's empty/building state, not a live iframe.
It does not establish authenticated route coverage, physical iOS keyboard
behavior, safe-area rendering on a notched device, backend task durability,
or performance parity with Cursor. Those remain separate acceptance work.

## Live iframe toolbar follow-up

A further browser test supplies a local interactive page to the real preview
iframe. It reproduced a 12px mobile address field before the toolbar change.
The phone toolbar now has a navigation/address row and a separate actions row;
controls have 44px targets, and the address uses 16px text without automatic
capitalization or correction. At the desktop breakpoint it returns to a
single row with 24px icon controls.

The additional test interacts inside the iframe, enters a route, returns with
Back, checks width/target sizes and then verifies the compact single-row
layout at a wider viewport. This covers a real local iframe, not remote
sandbox connectivity or publishing. Physical keyboard behavior remains open.
