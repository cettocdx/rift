# Compact terminal controls

The installed narrow terminal header wrapped “RIFT console” because view tabs,
profile selection, session buttons and six actions competed for one 35px row.
Compact sessions also omitted the keyboard/focus implementation of the full
terminal row. Host fullscreen used one state for its icon and another for its
accessible label.

The compact panel now uses a fixed view row and a short session row. Sessions
share the full panel's labels, connection descriptions, arrow/Home/End/Delete
navigation and focus handling. New terminal remains directly available; profile,
split and close actions use a Radix menu. The menu supports Escape and restores
focus to its trigger. Selected sessions scroll horizontally into view without
moving the chat. Pointer-coarse controls and menu items have 44px targets.

Fullscreen labels, pressed state and status now follow the owning host. Console
selection and mounted terminal sessions survive maximizing and switching views.
Shell profile selection now opens or reuses a Shell session, consistent with the
other launchers. New terminal's tooltip identifies its current launcher.

## Validation

Two regressions first failed: compact keyboard navigation and host-fullscreen
accessibility. After changes, the panel suite passed 19 tests, including opening
Shell from an empty layout and reusing it. TypeScript passed.

Eight isolated browser cases passed in Chromium/WebKit, light/dark, with mouse
and simulated touch. Each resizes the real panel to 422, 390, 360 and 320 CSS
pixels, checks header bounds and text wrapping, creates six sessions, navigates
with Home/End, opens/closes the real menu, closes a session, splits, and checks
selected-session visibility and retained terminal mounts through view switches.
Coarse control bounds are at least 44px. No page errors were observed.

This fixture uses the production panel, layout helpers, Radix controls and app
styles. Terminal content, native profile service and application providers are
synthetic: no PTY, model or network service is invoked. It verifies layout and
interaction, not native performance or physical-device usability. The separate
terminal renderer coverage is recorded in 2026-09-12-terminal-rendering.md.

Reproduce:
`pnpm exec playwright test -c e2e/mobile-fixture/playwright.terminal-header.config.ts`.

Desktop automation timed out while attempting to read Cursor this turn; no new
competitor parity or private-harness claim follows from this work.
