# Selected command help implementation plan

**Goal:** Make every selected slash command's description and usage readable without hover or accidentally executing it, across desktop and touch.

**Architecture:** Retain the existing production palette and its semantic listbox. Add a wrapping, bounded help region beside the list in document order, inside the same viewport-contained menu. Allocate space to both list and help, discard optional footer before making either unreachable. Keep current RIFT tokens and 44px touch rows.

**Tech stack:** React, CSS modules, Jest/testing-library, Chromium and WebKit fixture using the actual composer.

## Interaction decision

A separate sidecard risks clipping at narrow widths; expanding every row sacrifices scanning. Use a selected-item details region instead. Touch tap selects and shows details, then an explicit 44px Use action applies. Mouse clicks and ordinary Enter/Tab retain direct application. F1 focuses help; Escape from help returns to the composer. IME and modified editor keys remain untouched. Do not nest interactive controls inside listbox options. Keep native scroll gestures distinct from activation.

## Implementation and verification

- [x] Reproduce old full-help failure on production component: WebKit390 /goal description has clientWidth311 vs scrollWidth355 with hidden overflow and no full-help region.
- [x] Update `app/components/ChatInput/ComposerPalette.tsx` and its CSS module with bounded selected description/usage, touch selection and explicit application. Keep normal mouse and keyboard behavior.
- [x] Unit regressions assert full description, usage, touch selection without application, explicit Use, F1 focus, Escape return, preserved draft and existing IME/modifier handling.
- [ ] Independent e2e fixture tests on Chromium/WebKit at360/390/430px and desktop verify full help can be read,44pxcoarse targets, menu containment, selected-row hit visibility, no outer scroll, no unintended submit and keyboard behavior in constrainedheight.
- [ ] Review the source and rendered results together; correct any ancestor scrolling rather than accepting a passing layout-only assertion.
- [ ] Run required repository gates, commit without bypass, build immutable release preview, fresh idle check and serve exact BUILD_ID.
- [ ] Exercise the served native app's palette and archive final evidence/limitations externally.

The user explicitly authorized autonomous design and delegated implementation. No new design approval is needed. This change does not establish comparative native FPS, physical mobile keyboard behavior or overall production readiness.
