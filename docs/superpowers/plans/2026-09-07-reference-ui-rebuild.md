# Rift workspace UI rebuild

User-authorized implementation based on the supplied desktop references (IMG_2276/2280, IMG_2278/2277, composer IMG_2281, usage IMG_2279, plugin page crops). These define the direction; the enlarged details are not pixel specifications.

## Source
Production deployment dpl_9c781W6xLgnPkzEKBKT9B2RVnWVv: d173bde on build-engine-opencode. Implementation branches from its clean successor b8d8295 in /Users/cetto/Developer/rift-prod. The unrelated dirty /Users/cetto/rift checkout is preserved.

## Design
Quiet edge-to-edge desktop panes, a single navigation rail per screen, System typography with 12.5px navigation, 13px body text, 12px secondary controls, 14px navigation icons, 32px desktop controls / 44px touch targets. These current values supersede the earlier revisions below. Reading measure 720–880px. Continuous large composer corners; small controls get thin borders, top highlights and restrained shadows. Primary action/focus blue; semantic warnings retain meaning. Light and dark share geometry. Native window drag region, menus, resizing and keyboard navigation remain functional.

Composer: contextual heading; text; attachment/mode left and model/reasoning/send right; file/project/execution context below. No invented microphone action. Plugins: useful description, real connection state and one primary action; disconnect/edit/remove in overflow. No duplicate installed entries in catalog. Settings: hide workspace rail while settings rail is present; essential controls before collapsible theme editor.

## Implementation sequence
1. Shared workspace material/control CSS and palette defaults.
2. ProChatLayout + SidebarHeader + HomeCommandCenter + ChatInput composition.
3. McpMarketplace rows and discovery header, preserve OAuth and setup wizard.
4. SettingsShell and AppearanceSettingsTab grouping; usage meter and reset label.
5. Local browser review, existing relevant tests, typecheck/lint/build; fix issues found.

## Appllama research
7 paid calls, remaining 1493, reset 2026-10-01 UTC. ChatGPT metadata: Chat Response (oth_sl4vk), Chat Thread Scrolled (oth_swzdv), Settings Account, Settings App (oth_7mglz). Supports separate composer/response actions and grouped settings. Images were linked, not visually inspected; no usage-meter conclusion from these records. User-provided desktop images remain primary visual evidence.

## Validation boundary
Do not publish to production as part of local preview. Preserve actual auth/data and all supported routes. Never report generated capture/demo data as live product state. Verify actual components in browser where authenticated access is available; label development fixture previews explicitly.

## Implemented and verified

- Shared workspace materials, spacing, control geometry, readable system typography, focus indicators and light/dark Rift palette defaults. Existing saved palettes remain supported.
- Build composer uses one surface with separated action and workspace-context rows. Studio shows its composer before discovery. File picker and execution target use existing real state and handlers.
- Plugins have two-column rows, real connection health, a consistent detail dialog, category/search filtering and a single empty result. Connected catalog entries are not repeated. Existing OAuth, verification, credential wizard and removal confirmation remain covered by tests.
- Settings use one navigation rail with a bounded content column. Advanced theme editing remains available in an expandable section.
- Usage meter uses verified allowance data and the actual reset timestamp, including unavailable/invalid data handling.

Validation on 2026-09-07:
- 12 relevant Jest suites, 127 tests passed. Covers plugin connection flows and search recovery, mode/model/reasoning controls, file context and target selection, composer integration, mobile shell contract, usage states, palette defaults and appearance bootstrap.
- TypeScript no-emit check passed; ESLint on changed TypeScript files passed; git diff whitespace check passed.
- Next production build passed: compilation, TypeScript and 95 static pages. Final small CSS/dialog/search refinements were then exercised in the authenticated development preview and relevant tests.
- Chrome UI reviewed at 390×844, 1280×800 and normal 1512px viewport. 390px home document width remained 390px; composer bounds were 12–378px. Mobile navigation and disabled/filled composer states, search recovery, mode selection, plugin detail opening/Escape close, usage/reset display, Studio placement and single-rail Appearance settings were checked. Both light and dark home screens were inspected. No chat was submitted and no plugin connection was changed by these checks.
- Tauri dev build passed (531 build steps). A separate local RIFT UI Preview bundle opened the localhost:3020 WebKit view. Native accessibility inspection reached the authenticated Plugins screen. Native screenshot capture was unavailable and the preview subsequently exited; full native drag/resize visual QA is not claimed.

## Review and launch

Worktree: `/Users/cetto/.codex/worktrees/rift/reference-ui`
Branch: `codex/reference-ui-rebuild`

Web preview: `http://localhost:3020` (`pnpm dev:ui-preview`).
Native development launcher: `pnpm desktop:ui-preview` after starting the web preview. Its configuration and capability scope use a separate preview identifier and localhost:3020. A local debug app is also available at `dist/RIFT UI Preview.app`; the development server must be running.

No production deployment or replacement of the installed RIFT application was performed. Next and Tauri generated source-file changes were restored; build artifacts, copied local environment configuration and the preview app are ignored by Git.

## Reference revision after user feedback

The user rejected the first pass as too close to the original sidebar and home. The second pass changes the actual proportions and density:

- Default navigation width is 304px, with 38–40px desktop rows and 44px chat rows on mobile. Existing saved sidebar widths are preserved. Primary navigation is New chat, Plugins and Studio; Build, Hack Workbench and the remaining routes are available through More. Native Search remains available. Only one home entry is marked current.
- Geist is the default UI font; existing explicit font preferences remain respected. Light surfaces use a cool white/gray family; dark surfaces remain charcoal. Labels, titles, line icons and timestamps now share consistent sizes and baselines.
- Real update times accompany conversations. Mobile options have their own reserved space so timestamps and overflow controls cannot overlap. Settings and monthly usage are visible above the account identity on both desktop and mobile.
- The home composer has a 720px maximum width, a provider logo, a quieter reasoning label, small inset controls and a contextual footer. The light send button is charcoal; the enabled dark send button is blue. The lower background uses a restrained peach/blue/mint wash.
- A closable 300–370px workspace file pane balances the home at widths of 1180px and above. It uses the existing authenticated Workbench endpoints and selected project context. It loads only after Browse workspace/Refresh, rather than automatically waking a cloud workspace. It can filter entries, navigate folders, preview text files and append a file reference to the existing draft. Project changes remount the pane and abort pending requests. Existing conversation activity/preview panels retain their space.
- Settings navigation is 280px with 14px labels and an 800px inner reading area. The settings index uses legible 14px titles/12px descriptions and soft corners.

Second-pass validation:
- 24 relevant Jest suites passed, 198 tests, including six behavioral tests for the new file pane: explicit loading, real directory navigation, draft-preserving file context, retry, project isolation/abort and existing terminal/close callbacks.
- A further three appearance/settings suites passed, 19 tests. Total: 217 passing tests across 27 suites.
- TypeScript passed. ESLint reported no source-code errors; its sole warning concerned generated next-env.d.ts, which is restored before handoff.
- The final production build passed after the last layout refinements, including compilation, TypeScript and static page generation; see /tmp/rift-reference-v2-build-final.log.
- Chrome screenshots reviewed at 390×844, 1200×800 and the normal 1512px viewport. At 1200px the document remained exactly 1200px wide and the composer was 516px wide. Mobile timestamp overlap was found and fixed. Light/dark home, sidebar, Settings/Appearance and Plugins were inspected. File-pane close/reopen and real workspace loading were exercised. No chat or plugin connection was submitted by the agent.
- The separate local macOS RIFT UI Preview was opened again. Native accessibility and a successful screenshot confirmed the updated sidebar, typography, composer, window controls and an existing active conversation/activity panel. This supersedes the first-pass screenshot limitation. The existing active run was left alone; native drag/resize behavior was not exhaustively retested.

The preview remains local at localhost:3020; the production site and installed /Applications/RIFT.app have not been replaced.


## Third revision: compact typography and desktop pointer behavior

The user rejected the second pass because sidebar text and overall typography still looked too large. The default font now uses the operating system UI family. Explicit saved font selections remain supported. The type roles derive from the user-selected UI font size: at its 13px default, navigation is 12.5px, secondary controls are 12px, timestamps are 11px and the welcome/settings title is 20px. Navigation and conversation rows are 32px, with 14px navigation icons and normal tracking. The default resizable sidebar is 272px; saved custom widths remain respected. The file pane is 280–340px with 30px file rows.

A width-only mobile rule also enlarged inputs to 16px and navigation/toolbar targets to 44px in the user's narrow desktop preview. Touch-only font and target sizing now requires a coarse pointer. Fine-pointer desktop panes retain 13px inputs and 32px toolbar controls below 768px. Actual touch devices retain 16px inputs, 44px controls and safe-area layout. The drawer no longer applies unconditional 44px minimums. Its existing accessibility and route behavior are unchanged.

Observed after a full stylesheet refresh:
- Chrome, 1512×694: sidebar width 272px; navigation and conversation text 12.5px with 32px rows; welcome heading 20px; textarea 13px; system font computed throughout. Light home, Settings and Plugins reviewed.
- In-app preview, 466×652 with a fine pointer: dark home textarea 13px, toolbar 32px, compact 272px navigation drawer. Open/close navigation checked. Earlier HMR left an old global input rule loaded; a reload cleared it.
- Settings navigation computed at 12.5px / 32px; heading 20px.
- A successful screenshot of the separate native RIFT UI Preview showed the compact sidebar and Studio typography. No native navigation or ongoing user work was changed for this check.
- Coarse-pointer layout is retained by the CSS media rules; this pass did not exercise physical touch hardware.
- Six relevant Jest suites, 66 tests passed; TypeScript and changed-source ESLint passed. The previous drawer test's unconditional Tailwind minimum-height assertions were updated because target sizing now belongs to pointer-specific CSS. Dialog semantics and safe-area assertions remain.

Direct inspection of the running Codex application was attempted, including after the user explicitly clarified permission. The computer-use tool rejected access to com.openai.codex for safety reasons. No Codex desktop screenshot or live font measurements were obtained. User-provided reference images remain the visual source; exact live Codex parity is not claimed.

Final third-pass production build passed, including compilation, TypeScript and static generation; log: `/tmp/rift-reference-v3-build.log`. The build-generated changes to `tsconfig.json` and `next-env.d.ts` were restored. At 466px the document had no horizontal overflow and the composer measured 442px; all five toolbar controls measured 32px. Changes remain local in the existing reference-ui worktree.

## User-requested navigation order

Primary entries now appear as New chat, Build, Studio, Hack Workbench in both shells. Plugins, Agents, Runs, Tasks and Artifacts are under More; native Search is also inside More. Build and Hack no longer force More open; Plugins now opens it when active. Existing routing, access checks and saved fold preference remain intact. The sidebar navigation suite passed all 24 tests; changed-file ESLint and whitespace checks passed. Browser inspection confirmed the exact primary order and More open/close behavior.
