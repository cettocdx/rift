# Mobile tool panel width

Live inspection of the signed-in 3057 preview exposed a layout defect that the existing activity/preview fixture missed. Opening a completed terminal command at a 538-pixel viewport rendered its computer panel approximately 769 pixels wide, positioned from x=-115.7 to x=653.7. Output and controls were clipped at both edges.

The mobile computer caller passes centered flex alignment to `MobileToolDialog`. The dialog previously retained that alignment, while its content wrapper had automatic width. Long command text could determine the wrapper's intrinsic width. The shared full-screen dialog now overrides caller alignment with stretch/start and explicitly gives both header and content full width with shrinkable minimum width. Focus trapping, background inertness, safe-area padding, viewport-height handling, and scroll restoration are unchanged.

The fixture now reproduces the real caller's centered classes and can render a long terminal command using the production ComputerSidebar component. It supplies the corresponding navigation execution, so the normal deleted-tool handling does not close an invalid synthetic selection. The new browser assertion reproduced horizontal overflow before the source correction and passed afterward.

Verification:

- 48 mobile-tool Playwright tests passed across Chromium/WebKit at widths 360, 390 and 430. Includes long terminal bounds, changing visual viewport, keyboard-sized viewport simulations, touch closure, draft/reading preservation during output, preview navigation, and activity history. These are browser simulations, not physical iOS tests.
- Two MobileToolDialog unit tests passed.
- Scoped ESLint, whitespace checks and production build including TypeScript passed.
- Production release `.next-ui-release-1789601758616-8700cfc9` started in the separate 3057 preview. Reopened the same completed test chat after reload: its command, output, and final response remained present. Visually inspected the actual terminal detail again at 538 pixels: output and controls fit inside the viewport.
- Logs: `/tmp/rift-mobile-detail-red-0917.log`, `/tmp/rift-mobile-tools-green-0917.log`, `/tmp/rift-mobile-dialog-unit-0917.log`, `/tmp/rift-mobile-panel-build-0917.log`.
- Screenshots: `e2e/mobile-fixture/results/mobile-tools/` (`long-terminal-fit.png` per browser/width).

The main 3020 web/native application was not restarted. Its active user task remains separate from this preview rollout. Native iOS uses its own layout and this change does not claim a new native build or TestFlight upload. Startup latency remains above target; see `docs/performance/2026-09-17-mixed-startup-current.md`.
