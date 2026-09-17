# New project dialog with the mobile keyboard open

The actual `NewProjectDialog` extended outside a reduced visual viewport. Its
shared dialog centered against the layout viewport, while the form had neither
a height bound nor an internal scrolling surface. The name field also used
React autofocus before Radix recorded the opening focus target.

The dialog now observes the visible viewport, positions its center inside that
area, and limits its height with vertical scrolling. Radix owns initial focus;
closing restores a still-connected, enabled opening control without scrolling.
The shared dialog component is unchanged.

## Verification

The new real-component browser fixture reproduces the original overflow with a
360px viewport and a visible area from y=40 to y=360. The name draft survives
the viewport change, workflow selection remains usable, and Create is reachable
inside that area. Create, Cancel, Escape and reopening also verify keyboard
focus restoration.

Root verification: `pnpm exec playwright test --config
e2e/mobile-fixture/playwright.new-project.config.ts` passed all four Chromium
and WebKit mobile/desktop cases. Log: `/tmp/rift-new-project-root-verification.log`.

These tests simulate `visualViewport` and use a local creation callback. They
do not establish physical iPhone keyboard behavior or authenticated project
persistence; those remain separate acceptance checks.
