# RIFT page and interaction review — 2026-09-09

This is an engineering walkthrough of the running RIFT UI Preview, not a participant usability study or proof of Cursor/Claude/Codex parity. The correct checkout is `reference-ui`; the older installed RIFT app was not used. No model task, remote integration authorization, payment, deletion, or historical run replay was submitted.

Method: Usability Testing skill task scenarios and severity categories, plus the [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Inspect controls, empty states, navigation, focus, actual computed styles, and screenshots. Test production React/CSS where a DOM-only test cannot reproduce animation behavior.

## Reproduced and fixed

| Severity | Before | After | Why / evidence |
| --- | --- | --- | --- |
| Major | Escape left the effort popover visible with `data-state=closed`, `animation:none`; it overlapped the slash/context picker. | Escape, keyboard adjustment then Escape, and outside click remove the popover. | Keyboard modality changed the portal animation while Radix Presence was waiting for its exit event. Suppress decorative child effects only; do not cancel portal lifecycle animation. Real Chromium replay reproduced the failure before the fix and passed all six normal/reduced-motion scenarios afterwards. Live app slider count after Escape: 0. |
| Moderate | Empty terminal immediately scrolled to the bottom, cutting off the welcome wordmark. | Empty/new console starts at the top; real output still follows the tail; reading older output remains undisturbed. | Before: scrollTop 109, scrollHeight 552, viewport 443px. A regression test failed with 1000 instead of 0 before the change. Existing reader-position test remains passing. |
| Moderate | Global code typography overrode responsive ASCII artwork sizes. The hand image was 604px wide in a roughly 432px panel. | Decorative character art keeps its own responsive font sizing; code retains the user's font setting. | Actual production view: wordmark 9px, hand 8px; hand width 345px. Transcript height 443px equals viewport height; no welcome overflow. Previously both were forced to 14px. |
| Major | Opening Settings from the mobile account menu navigated behind a still-open navigation drawer. | Route changes close the mobile drawer, preserving desktop sidebar visibility. | Reproduced at 390×844. Failing regression added first; live same-path walkthrough after fix reports 0 Navigation dialogs. |
| Minor | Keyboard settings mixed Classic chat search, main app, and IDE bindings; Cmd-K had conflicting advertised actions. | Reference uses the existing registry filtered to the current shell. | Three tests cover Pro chat, IDE, and Classic chat. Removed implementation-focused explanatory copy. |

Locations:
- `app/components/ChatInput/ReasoningEffortSelector.module.css:377`, selector key handling in `ReasoningEffortSelector.tsx`.
- `app/components/terminal/RiftConsoleView.tsx:240`.
- `app/globals.css:1368`, `app/components/terminal/RiftTerminalArt.tsx` character-art boundary.
- `app/components/pro/ProChatLayout.tsx:97`.
- `app/components/KeyboardSettingsTab.tsx:39`.

## Walkthrough coverage

Default viewport 1280×720, plus 800×720 and 390×844. Viewport overrides reset afterwards. Dark theme restored after checking Light. Temporary text removed without sending.

| Surface | Actions checked | Result / limits |
| --- | --- | --- |
| Build / New chat | Initial load, effort open/Escape, slash and @ palettes, type a draft, navigate Plugins and return | Draft retained. Effort defect fixed. Nothing submitted. |
| Main navigation | Primary/More entries, sidebar open/close, mobile drawer, page changes | Mobile account-to-Settings defect fixed. Desktop rail remains available. |
| Plugins | Loaded connections/catalog, unmatched search, clear filters, desktop/mobile layout | Empty state and clearing work. 7 connections reported connected; Stripe/GitHub need attention. No OAuth flow changed. Mobile document width 390 equals viewport width. |
| Skills | Installed/catalog views, create dialog, initial focus, cancel | Form opens and cancels; no skill created or removed. |
| Agents | Loaded catalog/roster/team controls | Rendering inspected; creation/import/team mutation not exercised. |
| Runs | Loaded list and state counts | 100 recorded rows; no active runs reported by this list. No old run replay or cancellation. Detail/large-history operation needs a dedicated follow-up. |
| Tasks | Empty list/history; create form and cancel | Name autofocus; required controls present; empty submit disabled. No scheduled task created. |
| Artifacts | Loaded 13 items; Uploaded filter | Filter returned 4 uploaded images. No artifact deleted, downloaded, or regenerated. |
| Studio | Initial layout, Video filter/model library | Five video choices; composer reflects selection. No image/video generation. |
| Monthly usage | Open/close, displayed total and allowance | 2.58M available add-on credits shown. No billing mutation. |
| Account menu | Open, Settings entry, theme actions | Main/mobile paths checked. No logout. |
| Settings index | Search, unmatched result, clear, return link | Empty state works; return points to originating page. |
| General settings | Section rendering and instruction/note controls | No personal instruction or note mutation. |
| Appearance | Controls, Light/Dark switch | Both layouts checked; original Dark restored. Advanced theme import/export not exercised this pass. |
| Workbench & terminal settings | Desktop/runner/access states | Web desktop-only affordances explained. No runner disconnection or permission grant. |
| Agents & permissions settings | Crew/policy/queue rendering | No execution-policy change. |
| API keys | Headings/actions only | Secret values deliberately not inspected; no key created/revoked. |
| Privacy & security | Shared-chat/delete controls | Rendering only; destructive actions not executed. |
| Usage & billing | Headings/actions | Rendering only; no purchase/auto-reload mutation. |
| Keyboard & notifications | Desktop/mobile reference | Current-surface shortcut correction checked. |
| Account & organization | Headings/actions | Rendering only; no identity or account deletion. |
| Activity | Empty panel, New subagent form, cancel | No agent launched. |
| Browser panel | Add tab, address field, example.com, close | Web fallback says some sites require an external browser; this does not validate native computer/browser control. |
| RIFT console panel | Open, empty welcome, slash palette, cancel, independent input, close | Welcome scroll and artwork defects fixed. No LLM request or shell command executed. |
| Notebook / Hack Workbench | Notebook alias redirects to Hack; empty session, task drawer open/close, unmatched search and clear, Back to app | Ready with zero tools and transcript lines. Required-scope actions disabled. No assessment started or historical operation replayed. |
| IDE workspace | Initial Explorer/editor/agent layout; terminal panel hide/show; return home | Explorer loaded and local shell reported connected. Route initialized its shell session; no command typed, file edited, or agent request sent. |

## Validation

- 55 Jest tests across five suites passed: ReasoningEffortSelector, RiftConsoleView, useComposerDraft, ProChatLayout.mobile, KeyboardSettingsTab.
- `node scripts/verify-effort-dismissal.cjs`: six Chromium scenarios passed with actual Radix/CSS, normal and reduced motion. No provider or app server involved.
- Next production build, including TypeScript, passed into `.next-code-fluidity-release`.
- Production UI briefly served on 3023 solely for visual verification. It rendered the artwork with the intended responsive sizing.
- The long-lived 3020 Turbopack process retained old global CSS even after a page reload. Restarted only the web preview process using `dev:ui-preview:web`; did not restart workers, change saved runs, replay tools, or modify the older 3022 release server.
- After the refresh, the actual 3020 preview also measured the hand at 345px wide with 8px type; console scrollHeight and clientHeight both 443px, scrollTop 0. The fix is present in the running preview, not only the temporary production build.
- HMR emitted three hook-dependency-length warnings while editing the mounted console. These were edit-time warnings, not reproduced on a clean load. Do not count them as a production fix or hide unrelated runtime errors.

## Remaining acceptance work

This pass does **not** establish every possible flow is perfect. Native macOS drag regions, OS dialogs/computer permissions, standalone CLI latency, long live model runs, sleep/resume and network-loss recovery, payment/OAuth completion, and large historical run detail pages need separate end-to-end verification. Public auth/admin/legal pages and lab fixtures were not comprehensively re-exercised. IDE and Hack Workbench entry/navigation checks above do not establish their full execution lifecycle. Previous audit reports cover some of these areas but do not substitute for new live acceptance tests.

No claim of measured competitor parity is made. The previously recorded large-code rendering improvements remain a separate synthetic stress benchmark, not a result of this walkthrough.
