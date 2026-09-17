# Local Monaco and glass text follow-up

Monaco 0.55.1 is pinned and its complete min/vs distribution, fonts and notices are prepared during Next development/build. Production startup does not write assets. Both WorkbenchEditor and DiffView initialize the same local loader path, including diff-first use. No CDN fallback is configured.

Verification: the actual Monaco and DiffEditor components passed 16 Chromium/WebKit cases at 360, 390, 430 and 1200 CSS pixels. External requests were blocked; editor worker creation, text entry, dirty state, and exact provider save payload were checked. No console/page errors were observed. The file adapter is an in-memory boundary; this does not prove authenticated backend storage, physical mobile input or whole-app offline behavior. Asset preparation passed two integration tests comparing the full distribution and enforcing the installed version. Review found no actionable issue.

The Graphite secondary/tertiary text colors now blend alpha against their real surface, following the installed Cursor Agents 74%/60% roles, instead of mixing against a fixed background. Live RIFT settings confirmed System UI at 13px and translucency enabled; Today/Yesterday groups were visible. The relevant 32 component tests passed. Cursor live attachment timed out, so no pixel-identical native rendering or comparative performance claim is made.

Browser evidence: e2e/mobile-fixture/results/monaco-local/report.json and per-project screenshots (generated, ignored). Production build completed successfully before the fixture-only redirect correction. The WebKit harness now serves diff HTML directly because route.fulfill does not support 302 responses.

## Diff theme and mobile follow-up

A real-component regression reproduced `vs-dark` while the fixture's actual next-themes provider selected light. DiffView now registers the shared light/dark workbench themes and follows resolvedTheme; its shell uses semantic surface colors. Removed its global Monaco background CSS so mounting a diff cannot force unrelated editors transparent.

The same browser suite now switches light → dark → light and checks the actual Monaco class. Touch tabs initially measured 28px; they now measure at least 44px at all three coarse-pointer widths, while desktop remains compact. The harness includes DiffView in Tailwind source discovery. Final 16 cases passed in Chromium/WebKit. Visual inspection confirmed a white light diff with distinct inserted/removed lines. Original/Modified renderers and authenticated route acceptance remain separate coverage.

Production-parent review found a forced `.dark` wrapper in ComputerSidebar and hardcoded colors in ComputerCodeBlock. Both now inherit the app surface; Shiki selects its light theme in light mode. The fixture now bundles the actual ComputerCodeBlock and its CSS, and exercises Original and Modified instead of stubbing them.

That interaction reproduced `TextModel got disposed before DiffEditorWidget model got reset`. Diff stays mounted during mode switches. Layout cleanup detaches and disposes its two models before the library's passive editor cleanup; the library remains the editor owner. Final 16 browser cases cover all three modes, light/dark/light, touch geometry, real unmount, and zero page/console errors. A second lifecycle review found no concrete leak or race. Authenticated full-panel coverage remains unproven.

## Keyboard and live panel follow-up

Diff tabs now have a single roving Tab stop, ArrowLeft/Right wrapping, Home/End activation, unique tab/panel IDs, and focusable linked panels. The real diff browser test first failed at ArrowRight and now passes in all eight Chromium/WebKit mobile/desktop projects. Monaco stays mounted while inactive.

Live native inspection opened `/home/user/rota/src/main.js` from the completed conversation's changed-files card. The panel displayed its filename and toolbar but no content. This is an unresolved production observation, not covered by standalone fixture passes; the saved operation payload and live resolution path still need diagnosis. The panel was closed afterward without submitting or retrying work.

Scoped backend inspection resolved the blank-file cause: the last completed edit retained a 13,868-character `output.content` string headed `Latest content with line numbers:`, while sidebar-utils only accepted direct before/after fields or an unwrapped string. The parser now accepts this saved wrapper, strips pipe/tab line-number prefixes while preserving source indentation, and marks the missing before-snapshot as diffUnavailable. Two regressions failed before the fix; explicit empty after-content remains supported. No task was resumed or file rewritten during diagnosis.
