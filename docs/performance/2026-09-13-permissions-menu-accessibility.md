# Permissions menu keyboard and short-viewport correction

## Observed defects

The production `ApprovalModeSelector` exposed radio semantics but implemented
only clicks. With Run freely selected, opening the menu focused Review first;
arrow keys could not move/select permissions and all three buttons were tab stops.
The new browser keyboard case failed at the selected-focus assertion before the
fix (`/tmp/rift-permissions-keyboard-red.log`).

In a 360×280 mobile browser viewport, the nested permissions popover was taller
than the available space. Its top options extended above the viewport. The new
geometry assertion failed and a screenshot confirmed clipping
(`/tmp/rift-permissions-height-red.log`). This reproduces a short viewport
contract; it is not a physical phone/OS keyboard measurement.

## Change

- Opening focuses the selected option without scrolling the conversation.
- One radio is in the Tab sequence. Arrow keys move and select with wrapping;
  Home and End select the first/last option, matching the model selector.
- Focus revelation scrolls only the permissions panel.
- The popover uses Radix's measured available height, internal scrolling and an
  8px collision inset. Long menu content remains reachable inside the viewport.
- The mobile theme fixture now opens Chat settings before Permissions, matching
  the current production navigation rather than an obsolete toolbar entry.

## Verification

`playwright.approval-mode.config.ts`: **14 passed, 2 skipped** (mobile-only short
viewport cases skip desktop projects). Chromium and WebKit, 360px mobile and
1200px desktop, light/dark themes, selected state, persistence, arrow/Home/End
navigation, Escape/reopen focus, draft retention and hit-testing every short-menu
option. Log: `/tmp/rift-permissions-full.log`.

The existing mobile composer settings integration: **12 passed, 2 skipped**
(desktop skip), across Chromium/WebKit, 360/390/430px, coarse and fine pointer.
It verifies mode and permissions selection, project/execution menus, retained
draft and switching back to desktop width. Log:
`/tmp/rift-permissions-composer-integration.log`.

The successful short-viewport screenshot was visually inspected: the menu stays
inside the screen and scrolls its own options. Other application flows and a
physical keyboard-opening transition are not proven by these focused fixtures.
