# Isolated mobile browser verification

Run from the repository root:

```sh
pnpm exec playwright test --config=e2e/mobile-fixture/playwright.config.ts
```

Uses installed workspace dependencies and Playwright Chromium/WebKit browsers. The dedicated server binds `127.0.0.1:3037`, bundles current checkout code into a temporary directory, and stops after the run. It refuses to reuse an existing server. No Next server, environment file, account, model provider, Convex worker, or native application is needed. Browser requests outside the fixture origin are blocked. The production lab gate and authentication remain unchanged.

The harness imports the existing `/lab/scroll`, `/lab/focus`, and `/lab/browser` fixture components. It compiles real application tokens/Tailwind classes and CSS modules. Tests exercise production `useMessageScroll`, `FilePartRenderer`, Next Image, shared Input and Radix Popover controls. Convex calls throw if used; the browser route's Next search-params hook reads the test URL. The focus fixture's unrelated activity pane is omitted. The lab scroll debug toolbar alone wraps with touch-sized buttons in harness CSS, preventing its desktop layout from expanding the mobile viewport. This is test chrome, not a product toolbar change.

Chromium Pixel 7 and WebKit iPhone 15 profiles cover:

- Touch focus, Unicode draft entry, portal bounds, Escape dismissal and focus restoration.
- Fixture URL navigation and browser history.
- Transcript reading anchors at 360/390 CSS pixels through new output, panel width changes, and inserted/delayed-decoding images.
- Stable image frame height, no transcript horizontal overflow, following new output at the bottom, and persistent scroll-container identity.
- No uncaught browser errors.

For delayed offscreen decode, the test requests the real Next Image element eagerly after insertion. This models an image request finishing after the user has moved away; it does not alter production lazy-loading behavior. Scroll positioning is set programmatically to make anchor comparisons deterministic; panel/output controls are tapped through Playwright's touch API.

Screenshots and geometry attachments are written to ignored `results/`. These tests do **not** cover authenticated application routes, real account operations, a physical software keyboard, operating-system safe areas, or native apps. Passing them is not a full mobile release certification. The authenticated suite remains separate in the root `playwright.config.ts`; `.fixture.ts` names intentionally keep these tests out of its discovery.

## Production composer geometry

```sh
pnpm exec playwright test --config e2e/mobile-fixture/playwright.composer.config.ts
```

This separate configuration binds loopback port 3038 and explicitly discovers only `composer.fixture.ts`. Fourteen cases cover Chromium and WebKit at 360/390/430px with coarse touch and fine pointers, plus each engine at 1200px desktop. The original configuration continues to discover only `mobile.fixture.ts`.

The fixture imports production `ChatInputToolbar`, including BuildModelSelector, ReasoningEffortSelector, attachment, mode, approval and submit controls. It uses real InputProvider and ProShellProvider, Radix menus, production globals/workspace/typography CSS, installed Tailwind compilation and CSS modules. Global application state and authenticated identity are fixture boundaries; no backend runs. The textarea and constrained composer shell supply isolated host context; toolbar markup is never recreated. Submission, stopping and attachment execution throw, external requests fail, and test contexts contain no saved user state.

Checks require an intentional model/effort row above mobile actions, send on the attachment row at the right padding, a fully readable `Claude Fable 5.1` label, visible unobscured primary controls, 44px coarse-pointer primary targets, no horizontal overflow, and one row on desktop. Real model and effort menus open, dismiss and reopen; effort changes through its keyboard slider while the draft and enabled send state persist. Geometry JSON and screenshots are attached under ignored `results/composer/`. These are production-component fixture checks, not authenticated release-route or physical-device acceptance.

For a local regression comparison, `RIFT_COMPOSER_CSS=/absolute/path/to/workspace.css` supplies an alternate workspace stylesheet **only to the fixture compiler**, leaving production source untouched. Before the layout fix, the 390px coarse case failed because send and attachment rows differed by 48px. Reintroducing the former 74px model-label cap separately must fail the readable-label check. Omit this override for normal current-source verification.

## Plugin touch targets

```sh
pnpm exec playwright test --config e2e/mobile-fixture/playwright.plugins.config.ts
```

The isolated port 3039 fixture imports the complete production `McpMarketplace` and CSS, including Next Image and real Radix menus. Only the Convex query data and navigation/service boundaries are replaced: three synthetic custom connections represent connected, disabled and needs-attention states. Every mutation throws, non-read or external-origin requests fail, and no account state is loaded. Local plugin artwork is served from production `public/plugin-logos` files.

Fourteen Chromium/WebKit cases cover 360/390/430px coarse and fine pointers plus desktop. All installed identity, More, Connect and Reconnect targets must reach 44px on coarse mobile pointers and remain unclipped/hit-testable. Fine-pointer More stays 32px and connection actions stay 30px. Menus open and dismiss without invoking an action; the intentional horizontal category scroller remains contained. Measurements and screenshots attach under ignored `results/plugins/`.

The regression initially reproduced 19.5px installed-name targets and 32px More targets; existing mobile coarse Connect/Reconnect buttons were already 44px. The source fix reuses the existing logo/name/description area for the identity action and enlarges only coarse-pointer More controls. At 390px the three measured row heights remained exactly 68/75/75px before and after. This proves component behavior, not current immutable-release or authenticated route acceptance; a subsequent build is needed for that check.

## Settings switch touch area

```sh
pnpm exec playwright test --config e2e/mobile-fixture/playwright.switch.config.ts
```

Port 3040 imports the real shared Radix Switch and PersonalizationTab with production CSS. Notes customization is an in-memory fixture query/mutation that counts callbacks; no Convex service, account or real setting is involved. Additional labelled and compact-card rows reproduce the spacing of Appearance and agent-card consumers using the real Switch. Requests outside the loopback origin and non-read requests fail.

Twenty-eight Chromium/WebKit cases cover 360/390/430px coarse/fine pointers plus desktop, each at 844px and 500px height. Tests tap four points outside the visible track, require exactly one notes change per tap, verify checked state, track color and thumb movement, and preserve disabled behavior. A labelled row checks native label activation does not duplicate the callback. Disabled and neighboring actions remain isolated; the compact footer reserves the switch's entire box without overlapping the card action above it. Reduced-height tests scroll controls into view and hit-test their reachable touch padding.

Before the fix, the 32×18.4px switch missed padding taps. Coarse pointers now receive a real 44×44px button enclosing the same 32×18.4px track. Fine-pointer dimensions stay unchanged. Compact touch rows may grow to accommodate the button; no negative margins or invisible overlapping halos are used. Screenshots and dimensions attach under ignored `results/switch/`. This is component and browser-emulation evidence, not a physical keyboard or live authenticated settings test.

For discovery without overwriting the execution report, append `--list --reporter=line` to these fixture commands. A bare `--list` also invokes the JSON reporter and replaces the completed-run report with skipped discovery entries.

## Settings action and select targets

```sh
pnpm exec playwright test --config e2e/mobile-fixture/playwright.settings.config.ts
```

Port 3041 renders production SettingsShell with ApiKeysTab, AccountTab, ExtraUsageSection and AppearanceSettingsTab. Real account and credit dialogs render through their production portals, with production globals/workspace/typography CSS and CSS modules. Only authentication, navigation and service boundaries are replaced. API creation, revocation and clipboard copying count in-memory fixture callbacks; all other mutations and billing actions throw and are recorded as failures. No account, real API key, clipboard change, purchase or deletion is involved. Requests outside the fixture origin and non-read requests fail.

Twenty-eight Chromium/WebKit cases cover 360/390/430px coarse and fine pointers plus 1200px desktop, each at 844px and 500px height. Buttons, text input and font selects must be visible, hit-testable and at least 44×44px on coarse pointers; fine-pointer dimensions stay unchanged. Synthetic create/copy each invoke exactly one callback. Revoke is armed through real pointer clicks/taps and cancelled by clicking outside; repeating that first activation must not call the synthetic revoke callback. Two deliberate confirmation taps must then invoke exactly one synthetic callback. An outside-pointer listener cancels the production confirmation even when WebKit does not focus its button; existing keyboard blur cancellation remains. Account deletion stays disabled; the credit purchase control is never activated. Dialogs open, scroll and close; screenshots and geometry attach under ignored `results/settings/`. Browser errors, horizontal overflow and protected service calls fail the test. Only the shared classifier’s exact known WebKit interactive-widget notice is recorded separately in a diagnostic attachment.

The regression reproduced 36px create, 28px revoke, 26px copy, 32px account/billing actions and 28px font selects on coarse mobile pointers. A Settings-scoped CSS module now reserves actual 44px control boxes. The account dialog explicitly opts in and reserves header space for its enlarged close button. The credit purchase dialog already met its primary target requirement. These are actual production-component tests with synthetic service boundaries, not authenticated release-route or physical-device acceptance. A subsequent production build is required to verify the source change in the running release.

## Runs, Tasks, project Agents and Appearance touch targets

```sh
pnpm exec playwright test --config e2e/mobile-fixture/playwright.workspace-targets.config.ts
```

The separate loopback fixture on port 3042 imports production RunsWorkbench,
TaskCenter, ProjectBotsWorkbench and AppearanceSettingsTab with the actual shared
controls, CSS modules and compiled application styles. Global subscription and
Convex reads are isolated fixture boundaries: one completed run, one project and
empty task/bot lists. Every backend mutation/action attempt is recorded, throws and fails the test;
all external or non-read requests fail. The unmounted advanced agent/profile editors are excluded from the
bundle; their behavior is not covered. No environment files or authenticated
account state are loaded.

The explicit 112-case matrix covers Chromium/WebKit at 360/390/430px with coarse
and fine pointers plus 1200px desktop, in light and dark themes. It checks actual
44px coarse targets, ancestor clipping, five-point overlay hit tests, scrolling,
viewport bounds and unchanged fine-pointer dimensions. Run/task filters change
local selection. Task/project/bot dialogs open and close without creating records;
a task input accepts a local draft. Appearance range keyboard changes, actual taps at the top/bottom of the
44px range padding, and color input changes use the production local preference behavior inside disposable
browser contexts. Native color inputs must expose their whole touch target rather
than clipping a larger input inside a small swatch. OS color-picker UI and physical
phone keyboards are not covered.

Screenshots and geometry attach under ignored `results/workspace-targets/`.
This is production-component fixture evidence, not authenticated release-route
acceptance. Append `--list --reporter=line` to collect without overwriting an
execution report.
