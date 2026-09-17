# Mobile Safari follow-up: invisible Hack task navigation

## Reproduced defect

The Hack titlebar toggled `sidebarOpen` at phone widths, but responsive CSS hid `.ops` through 780 px regardless of that state. Thus the button changed from Show to Hide without showing any tasks. The prior regression test only checked those labels, so it passed despite unusable navigation.

## Fix

The header now offers a mobile task button that opens the existing searchable Security tasks dialog. The desktop rail toggle remains on desktop. The mobile button has a 44 px touch target and dialog semantics. No assessment execution or permissions changed.

## Verification

- Strengthened regression asserted visible dialog and search field: failed on all six phone/browser combinations before the fix.
- After the fix: 6/6 passed across Chromium/WebKit and 360/390/430 px, including simulated keyboard resize, closing tasks, preserved draft and output.
- Header/lifecycle Jest suites: 57/57 passed. Targeted ESLint and diff whitespace checks passed.
- Production build succeeded: `.next-ui-release-1789612994816-12c9ff49`.
- Safari iOS 26.5, Device Hub: directly reproduced the invisible panel before the fix and visually confirmed the task dialog after it. Screenshot: `/tmp/rift-safari-hack-task-dialog.png`.
- Build fixture in Safari: software keyboard left header/composer visible; Activity opened and closed; embedded preview rendered and its button changed to Interacted. These are fixture UI observations, not authenticated live task results.

## Remaining boundaries

The standalone XCUITest runner compiled and signed for the physical iPhone, but the locked phone prevented execution. The simulator automation stalled during Apple accessibility loading; manual Safari checks above are recorded separately, not as automated passes. Actual phone execution remains pending. Long-lived backend tasks, third-party MCP credentials and the main worker rollout are not established by this UI check. No zero-failure or zero-disconnection guarantee is claimed.

Logs: `/tmp/rift-hack-task-panel-red.log`, `/tmp/rift-hack-task-panel-green-final.log`, `/tmp/rift-hack-task-panel-jest.log`, `/tmp/rift-mobile-task-dialog-build.log`.
