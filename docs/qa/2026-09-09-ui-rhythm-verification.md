# UI rhythm verification — 2026-09-09

Scope: typography and layout changes from the product-rhythm pass. Checks cover
real interactions, visible clipping, viewport bounds and keyboard dismissal.
No agent run, integration connection or billing change is needed for this pass.

## Inventory

- Desktop 1440×900 and narrow 390×844.
- Bots: add dialog, long name draft, meetings dialog, task dialog, empty search.
- Tasks: create dialog and keyboard dismissal.
- Composer: project, execution, mode, permissions, model, effort, slash/context menus.
- Settings: light/dark theme round trip and enlarged UI text round trip.
- Pages: Tasks, Bots, Settings, Plugins, Runs, Artifacts, Studio and chat.
- Off-happy-path: empty search; long draft and enlarged type in a narrow window.

## Results

28 live geometry samples were collected through the in-app browser, with
screenshots for the principal dialog, palette and panel states. No sample
produced document-level horizontal overflow.

| Check | Result |
| --- | --- |
| Add bot desktop | 600px wide; heading 14px/500, page title 18px/500 |
| Bot, meeting and task dialogs at 390px | Found missing side gutters; fixed and rechecked at 366px width, 12px sides |
| Long bot name | Input scrolls internally; does not widen the dialog |
| Empty bot search | Empty-result message rendered; no horizontal overflow |
| Meeting / task dismissal | Escape closes without creating records |
| Appearance light, 18px UI, 390px viewport | Title scales to 23px; no horizontal overflow |
| Add bot with 18px UI | Title scales to 19px; form scrolls internally; name and submit remain reachable |
| Six composer menus in light desktop and narrow viewport | All panel bounds fit within viewport; Escape dismissal exercised |
| Slash / context lists | 288px internal scroll viewport; long list intentionally exceeds that viewport; keyboard moves selection |
| Monthly usage dark | 320px wide; both loading and loaded panel bounds fit |
| Activity empty state | Panel opens, shows empty state and closes; no document overflow |

The effort panel reports internal horizontal overflow from its clipped surge
and thumb decoration, not overflowing text. The slash/context listbox reports
its full content height (1645px / 1954.5px); its enclosing scroll viewport is
288px tall and fits on screen. These are intentional internal layouts, not
page overflow failures.

## Fixes from this pass

- Shared DialogContent width now reserves 24px of viewport space even when a
  consumer overrides its maximum width.
- Bot catalog, project and meeting dialogs cap their own width to viewport
  minus 24px, preserving the same side gutters.

Theme was restored to Dark and UI type to 13px. Draft input was cleared, no
bot/task/meeting was submitted, and the original Agents route was restored.
The viewport override is reset after the checks.

## Coverage limits

The previous pass visually covered eight main pages. This pass concentrates on
interactive states affected by the shared typography. It does not certify every
account state, payment flow, external integration, native OS dialog, or long
running agent output. No claim of universal pixel-perfect behavior is made.

Final validation after the gutter fix: 77 tests passed across five relevant
component suites; `tsc --noEmit` passed; `git diff --check` passed.
