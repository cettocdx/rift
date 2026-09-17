# Mobile chat simplification — 13 September 2026

The user requested a simpler, ChatGPT-like mobile conversation, while keeping
RIFT's working modes and tools available. The desktop retains its existing
composer. Profile photos and removal of the desktop More → Search row are
included in the same requested UI pass.

## Delivered behavior

- Phone composer: attachment, readable model selection, Chat settings and Send
  share one row. Effort remains available in the model parameter menu.
- Mode, permissions, workspace and context usage move into Chat settings.
  Existing selectors own the values and execution behavior. No model, mode,
  permission or execution target is changed automatically by this redesign.
- The settings sheet follows the reported visual viewport from its first Radix
  portal attachment. Focus, dismissal and scroll locking use the existing Radix
  dialog. Nested menus remain accessible. Widening to desktop unmounts the sheet.
- `/project` reveals mobile settings and the project picker without navigating
  away from the draft, including when session storage is unavailable. Bot-bound
  projects remain locked, with a visible explanation of how to change project.
- Mobile Return inserts a newline; Send submits. Desktop Return still submits.
- Phone styling uses a quieter header, rounded neutral composer, 16px input
  text and 44px controls. Light and dark surfaces use the existing theme.
- Account avatars read `AuthUser.profilePictureUrl`, the field already populated
  by `useAuth`. Missing or failed photos retain initials. No photo is fabricated
  for an account without one.
- Desktop and web More menus omit the Search row. Mobile retains Search and
  closes navigation before opening it. Keyboard search remains available.

## Verification and evidence

- Regression first: the one-row assertion failed on the prior mobile layout,
  with model/action centers 48px apart (`/tmp/rift-simple-mobile-red.log`).
- Composer browser suite: 82 passed, 2 desktop-only skips; Chromium and WebKit,
  widths 360/390/430 and desktop, touch and fine pointers. Checks readable model
  names, hit targets, model/effort changes, draft retention, permissions, project
  and execution menus, long drafts, active goals, send/stop, and width changes.
  Log: `/tmp/rift-simple-mobile-composer-full.log`.
- Chat shell browser suite: 52 passed, 4 mobile-only skips. Questions, 240–480px
  available heights, simulated visual viewport offsets, first-open settings
  geometry, drawer restoration and transcript scrolling. Log:
  `/tmp/rift-simple-mobile-chat-full.log`.
- Targeted Jest: 54 sidebar identity/navigation tests; 126 composer/mobile shell
  tests; 57 additional command, settings and input integration tests (overlapping
  suites, not additive totals).
- Return/newline browser checks: 14 passed across the same viewport/pointer
  matrix (`/tmp/rift-simple-mobile-return.log`).
- The design detector returned no findings for the changed mobile surface.

## Bounds

Browser fixtures import production controls, CSS and viewport logic, while
isolating authentication, provider calls and other services. These are browser
layout/interaction checks, not proof of real-device keyboard behavior, a live
agent run, native mobile parity or whole-application performance. The prior
long-task, provider latency and release-readiness work remains outstanding.
