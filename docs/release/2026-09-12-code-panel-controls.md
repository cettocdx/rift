# Code panel controls

The saved-file viewer ignored changes to its parent's `wrap` prop after mount.
ComputerSidebar owns an outer wrap button and passes the value to
ComputerCodeBlock with its internal toolbar hidden. A regression rerender
confirmed that changing true to false retained `white-space: pre-wrap`.
A second regression confirmed that copy removed indentation and final newline.
Both failed before the fix and pass afterward.

The optional internal toolbar also overlaid the first line, provided only 24px
hit targets on touch, and suppressed the global focus fallback. It now reserves
its own row, uses 44px coarse-pointer targets and an explicit themed outline.
Current production callers hide that internal toolbar; the parent wrap fix
therefore matters directly to the existing desktop panel, while the dedicated
fixture verifies the optional toolbar rather than claiming it is exposed there.

Browser coverage uses the real component with app CSS at 360/390/430 coarse
widths and desktop, in Chromium and WebKit. It checks parent wrapping, local
wrapping, pressed state, non-overlap, target rectangles, keyboard focus outline,
no page overflow, and the exact string passed to the clipboard API. The clipboard
boundary is substituted; OS clipboard permissions are not tested. WebKit uses
Alt+Tab consistently with existing Safari fixtures. The existing 16 real Monaco
and diff cases also pass with the component change.

This is bounded component coverage, not whole-app mobile acceptance, physical
mobile-device validation or Cursor performance parity.
