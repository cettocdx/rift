# RIFT application fluidity review

Date: 2026-09-08. Checkout: `reference-ui`, preview on port 3020.

This was an expert inspection using the running UI, native desktop applications, code tracing and regression tests. It was not a participant usability study or a production performance benchmark. Existing user messages, files, permissions and account settings were preserved; no new agent task was submitted during this audit.

## Confirmed defects and changes

| Before | After | Why |
| --- | --- | --- |
| Build and Studio both used the `new` draft key. Build text appeared in Studio. | Build retains the legacy key; Studio uses a purpose-specific key. | Different workspaces need independent unsent drafts. |
| Draft persistence waited 500 ms; rapid navigation could lose the latest input or store the previous screen's text. | Restore in the layout phase; synchronously flush the current input ref on departure and pagehide. Preserve a follow-up only when its own new conversation becomes durable. | Navigation should preserve the user's place and text. |
| A departing composer could restore a draft after sign-out cleared storage. | Draft persistence is guarded by the storage-clear epoch. | Cleanup must respect explicit account cleanup. |
| A retained, already-hidden native browser measured its bounds on unrelated transcript mutations. | Hidden browser returns before geometry reads; visibility transitions and active geometry tracking still run. | Background panels should not add layout work to typing and streaming. |
| Runs had no route-level initial loading UI and was absent from the sidebar prefetch list. | Added a reduced-motion-aware loading skeleton and route prefetch. | Immediate, stable feedback makes navigation understandable while server data loads. |
| A completed run with no detailed events was described as predating logging. | Empty state now says no detailed event log was recorded and points to the conversation. | Missing data does not establish when or why it was missing. |

## Screens and interactions exercised

| Surface | Exercise and result |
| --- | --- |
| Build / new chat | Typed without sending; opened effort selection, dismissed it, navigated away and returned. Original 558-character Build draft remained intact. |
| Studio | Opened model/media filters, library and composer. Verified empty Studio draft despite existing Build draft, then rapid navigation with a Studio-only test draft. Removed test text afterward. |
| Plugins | Searched GitHub, switched Skills, checked empty search results and reset search. Existing GitHub connection needs attention; no reconnect or OAuth permissions were changed. |
| Agents | Inspected catalog and crew; opened New agent, keyboard-focused controls, cancelled without creating an agent. |
| Runs | Inspected list, Running empty filter, restored All, opened a completed run and its conversation destination. |
| Tasks | Inspected All/Scheduled/Completed and creation form; cancelled without creating a task. |
| Artifacts | Inspected six existing items, opened an image preview and closed it. |
| Hack Workbench | Returned to the existing session and its two responses; inspected scope, disabled controls and actual zero tool count. See the separate Hack audit for live execution tests and producer limits. |
| Settings | Entered General, Appearance, Workbench & terminal, Agents & permissions, API keys, Privacy & security, Usage & billing, Keyboard & notifications, Account & organization. Checked search and Back to app. No secret reveal, account deletion or permission action. |
| Light / dark | Switched appearance and restored Dark. No horizontal page overflow observed in inspected settings views. |
| Activity dock | Opened, expanded, restored beside chat and closed. Inspected empty activity state and tab menu. |
| Terminal dock | Opened console and slash menu. An unsent terminal draft did not enter the main chat composer. Cleared audit input. |
| Browser dock | Opened example.com, verified its visible page and browser controls. |
| Files dock | Loaded actual workspace folders and opened form-sequencer; child files appeared. No file modifications. |
| Review dock | Opened the no-change conversation state; closed added audit tabs afterward. |
| Monthly usage | Opened and closed card. Measured 320 × 418 px in a 1334 × 694 viewport, without horizontal page overflow. |

These are the main signed-in product surfaces and settings sections. This is not a claim to have exercised every destructive action, integration, lab fixture, modal or network failure state.

## Native desktop comparison

Opened Cursor, Claude and the correct RIFT UI Preview application, rather than the old RIFT installation.

- Cursor's agent composer and compact model/effort popover keep the underlying layout in place. Its controls group model, context and effort without moving the working surface.
- Claude's compact effort popover opens adjacent to its trigger and closes without reflowing the composer. The task surface remains stable while the user changes a control.
- RIFT's dock open/close, expand/restore and effort interactions were exercised against those observable patterns. Repeated app switching after hot reload settled preserved the RIFT conversation. Window controls and rounded native frame were visually inspected.

The useful comparison is stable layout, preserved state, local feedback and little unnecessary background work. Visual inspection does not establish Cursor's or Claude's internal architecture, nor does it provide an equivalent numerical performance benchmark.

## Measurements

### Hidden native browser regression

A focused test retained the browser, made its tab inactive, settled visibility work, then applied 20 unrelated transcript text mutations.

- Before fix: 44 calls to `getBoundingClientRect`.
- After fix: 0 calls.
- All 12 browser tests passed, including reactivation, visibility/overlay handling and native layout queuing.

This result concerns already-hidden tabs. Active native browser geometry tracking remains necessary.

### Development UI interaction sample

Opt-in development probe: append `?riftPerf=1` on a full navigation. Its hidden `#rift-ui-performance` output records bounded Event Timing, long-task, frame and layout-shift samples locally. It does not capture text or send telemetry. Frame sampling runs briefly after interaction, not continuously during idle.

Procedure: reload a short saved Build conversation, let startup settle, type an unsent sentence, open the effort popover, then read the probe. Remove the temporary input afterward.

| Recorded metric | Result |
| --- | --- |
| Interaction-event duration p95 | 32 ms |
| Largest recorded click duration | 64 ms |
| Recorded input processing delay | 0–1 ms |
| Sampled frame interval p95 | 9.2 ms |
| Largest sampled frame interval | 67 ms |
| Frame samples | 433 |
| New long tasks during this interaction sample | 0 |

There were already three startup long tasks, with a maximum of 282 ms, before the sample. Recorded layout shift remained 0.014. Event Timing uses a 16 ms reporting threshold, so these values are not a complete keystroke distribution or an official INP score. The earlier mixed navigation/HMR trace is not comparable to this warmed sample and is not used to claim a speedup. This sample also does not measure real streaming under load or native application FPS.

## Motion review decision

Keep short functional transitions and existing reduced-motion handling. Do not add decorative motion to frequent typing or navigation. The fixes in this audit prioritize preserved drafts, stable panels and immediate loading feedback. The Runs skeleton disables pulsing under reduced motion. There is no basis in this audit to replace all transitions or add longer easing to make the application feel faster.

## Verification

- 111 tests passed across 10 targeted suites: draft lifecycle, input performance, composer integration, native browser, workbench dock/mobile navigation/performance budgets, Runs list/detail and effort selector.
- TypeScript `tsc --noEmit` passed after the final draft cleanup safeguard.
- Live UI verified purpose-specific draft isolation, fast-navigation restoration and preservation of the original Build draft.
- Live UI verified independent terminal input, panel switching, file tree navigation and settings return navigation.

## Remaining limits

- Production cold starts, long cloud jobs, expired sandboxes and interrupted server processes need execution-layer validation; this UI audit does not prove that a task can never disconnect.
- Hack's existing 370-second preemptive stop remains documented in `hack-workbench-readability-and-navigation.md`.
- Native competitor comparisons are qualitative. No equivalent native frame-timing benchmark was collected.
- Responsive workbench behavior has regression-test coverage; this pass did not exhaustively measure every screen at every viewport size.
- The GitHub integration attention state was observed, not repaired by changing account access during a UI audit.
