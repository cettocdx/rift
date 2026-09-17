# Codex-style dock: source and implementation reference

Research date: 2026-09-07. Scope: RIFT conversation activity, files, review, preview, browser and terminal navigation. This is a bounded implementation reference, not a capability benchmark or a claim that RIFT reproduces private Codex internals.

The main RIFT gap was competing panel state and component lifetime. A preview, a selected tool result and the terminal could each own visibility separately. A single explicit tab selection can resolve that conflict, but it must preserve mounted browser/terminal state and keep chat-owned content from leaking across conversations. Official documentation supports the integrated workflow; it does not specify an exact React architecture, font metric or tab reducer.

## Evidence and limits

| Evidence class                                      | What it establishes                                                                                                                                                  | What it does not establish                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| User-supplied Codex screenshots in the conversation | Visible edited-file summaries, per-file change counts, a Review action and compact window controls. These are visual targets, not instructions embedded in an image. | Exact CSS values, accessible interaction behavior, runtime persistence or hidden implementation. Images were resized in the conversation. |
| The supplied 19:55 recording and 19:58 screenshots  | Shared tabs, agent details, independent scrolling, file-error state and browser/add-menu controls; sampled transitions are recorded below.                           | Visual observations establish the supplied version's behavior, not a public Codex API contract or exact CSS measurements.                 |
| Live Codex inspection                               | The computer-use tool denied access to the running Codex app.                                                                                                        | No live Codex inspection, screen measurement or successful interaction is claimed. The denial was not worked around through another app.  |
| RIFT source inspection                              | Existing activation paths, conditional mounts, terminal ownership, live-output separation and regression risks described below.                                      | Successful end-to-end native rendering, working external authentication or agent browser automation.                                      |
| Official OpenAI documentation                       | The specific documented browser, terminal and review capabilities listed below.                                                                                      | Identical functionality in every historical desktop version, or feature parity merely from showing similarly named tabs.                  |

## Supplied-media observations

The supplied recording was sampled at approximately 1, 7, 13 and 19 seconds. These observations come from the supplied media, not from operating the running Codex app:

- The right pane shares tabs across content types. Agent detail uses a back arrow, a small pastel identity mark/name and a thin divider. Its body contains collapsed tool rows, a summary and an edited-files card; it scrolls independently of the chat.
- At approximately 7 seconds, a file tab displays a breadcrumb, a right file tree and an inline “Could not open file” error. Error recovery belongs inside the content pane; a tab should not imply a successful file load.
- At approximately 13 seconds, selecting the Subagents tab restores the competitor-research detail and its scroll position. This motivates preserving opened panel state during tab switches; it does not prove persistence after application restart.
- The 19:58 screenshots show Active 3 / Done 3 lists without heavy row borders, small pastel identity marks, primary names, quieter status text and time aligned at the right.
- The add menu offers Review, Terminal, Browser, Files and Sidechat. A new browser tab has back/forward/reload controls, an address field and a centered globe in its empty state.

The implementation scope deliberately omits Sidechat because it has no completed workflow here. The Files surface reuses RIFT's existing file preview; it is not a full editable IDE/file tree. Review represents confirmed conversation changes, not the entire Git working tree. These differences should remain explicit rather than being disguised by matching labels.

## Official source ledger

1. **OpenAI Help Center — Using the built-in browser in the ChatGPT desktop app.** Accessed September 7; page displayed “Updated: 2 days ago,” not an absolute publication date. Documents multiple tabs, a browser state separate from the regular browser, navigation/downloads and website permissions. This supports separate browser state and an explicit open action. It does not make an iframe equivalent to a full browser or establish RIFT support for extensions/password management. [Source](https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app)

2. **OpenAI / ChatGPT Learn — Browser.** Accessed September 7; no publication date visible. The former `developers.openai.com/codex/app/browser` route redirects to the current documentation. It describes previewing local pages, annotation-based feedback, browser navigation and computer use, alongside distinct desktop and cloud browsing sections. Those surfaces must not be conflated. RIFT needs its own verified native/browser implementation and permission boundaries; browser-looking chrome alone proves neither control nor isolation. [Source](https://learn.chatgpt.com/docs/browser?surface=app)

3. **OpenAI / ChatGPT Learn — Integrated terminal.** Accessed September 7; no publication date visible. Documents a terminal associated with a chat's project or worktree, reachable without leaving the chat, for command execution and validation. The page also says the agent can read terminal output. RIFT retaining one terminal instance supports session continuity, but does not itself prove equivalent agent access or project isolation. [Source](https://learn.chatgpt.com/docs/integrated-terminal)

4. **OpenAI / ChatGPT Learn — Code review.** Accessed September 7; no publication date visible. Documents a Git-backed review pane, including repository changes beyond agent edits and multiple review scopes. RIFT's proposed Review tab lists confirmed changes extracted from conversation tool results; that narrower scope should be clear. Do not imply that it includes all uncommitted repository changes, staging, commits or rollback. [Source](https://learn.chatgpt.com/docs/code-review)

5. **OpenAI — Introducing the Codex app.** Published February 2, 2026; includes a March 4 Windows availability update and directs readers to current product documentation. Establishes the original focus on parallel project threads, worktrees and in-thread change review. Used as historical workflow context, not proof of the current dock's exact controls. [Source](https://openai.com/index/introducing-the-codex-app/)

These are primary sources. The search was narrowed from broad Codex feature results to official documentation, then followed the browser page's terminal/review dependencies. Community issues and third-party summaries were not used as evidence. Further broad competitor research would not resolve the remaining local lifecycle and rendering checks.

## RIFT findings and adaptation

The source audit preceded the new dock integration. References identify stable components/functions; line numbers will change while parallel implementation proceeds.

| Before: code evidence                                                                                                                                                      | Adaptation and reason                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.tsx` computed preview priority separately from `sidebarOpen` and `sidebarContent`. A tool result could be opened while the preview remained the visible pane.        | One active tab determines what the dock shows. Explicit file/agent actions must activate their destination.                                              |
| `ComputerSidebarBase` retained local Activity/content view mode, independently of new content supplied from outside.                                                       | Controlled selection and typed open intents must select the requested content, rather than merely changing a hidden prop.                                |
| Conditional `BuildPreviewPanel` versus `ComputerSidebar` rendering unmounted inactive content. Preview component state included history, device, reload and address state. | Keep opened stateful panels mounted while hidden; only deliberate close or conversation reset should discard the appropriate state.                      |
| `TerminalDock` already kept its provider/panel tree mounted after first open, preserving terminal sessions while hidden.                                                   | Keep that single owner. Position its persistent DOM over the selected terminal slot instead of creating a second terminal or moving it through a portal. |
| `SidebarContent` is a structural union of files, terminal/proxy output, searches, notes and shared files.                                                                  | Use existing type guards and stable tool-call identity. Preserve less common tool detail types instead of treating every output as a file.               |
| `LiveSidebarContentProvider` separately carries throttled streaming output.                                                                                                | Dock state stores tab metadata and explicitly opened snapshots only. Do not copy every live output chunk into the reducer.                               |
| Route teardown distinguishes real chat switches from initial new-chat ID promotion.                                                                                        | Reset chat-owned tabs on a real conversation change; preserve the initial `/` to `/c/:id` promotion. Keep placement as a layout preference.              |

The relevant local implementation files are `app/components/chat.tsx`, `app/components/ComputerSidebar.tsx`, `app/components/BuildPreviewPanel.tsx`, `app/components/terminal/TerminalDock.tsx`, `app/contexts/GlobalState.tsx`, `types/chat.ts`, and `app/contexts/LiveSidebarContent.tsx`. This source finding is distinct from claiming that every integration path has already passed live validation.

## Implementation and verification

- `lib/workbench/dock-state.ts`: pure open/select/close/hide/show/placement/maximize/update/clear reducer. Activity, Files, Terminal, Preview and Review are singletons; callers supply browser instance IDs. Tool content uses stable tool-call identity with type-specific fallbacks. Closing the active tab selects its neighbor; hiding keeps tabs; clearing removes conversation snapshots while retaining placement.
- `lib/workbench/events.ts`: typed Activity/workbench open intents and hide/maximize intents. These are UI navigation signals, not authorization for tool execution.
- `TerminalDock.tsx`: one persistent terminal tree; host geometry follows resize and relevant DOM changes. An inactive or zero-size host hides and makes the terminal inert. Embedded mode delegates dock controls; the existing bottom layout remains available when no host exists.

Verification: **35 tests passed across 3 suites** (`dock-state`, `TerminalDock`, `WorkbenchTerminalPanel`); scoped ESLint and diff whitespace checks passed. New behavior tests check host geometry updates, hidden/accessibility state, active/inactive switches, host removal/reinsertion, preserved DOM/input state, singleton Review and event routing. Logs are in `/tmp/rift-terminal-host-tests.log` and `/tmp/rift-terminal-host-lint.log`.

These automated tests use local DOM/session fixtures, not a paid model, a real external site or a newly spawned PTY. Native checks must be reported separately from unit tests. Full Codex browser/review parity does not follow from the automated results.

Additional UI verification: **18 WorkbenchDock tests passed**, with scoped ESLint and formatting checks. They cover the real menu/reducer integration, arrow/Home/End/Delete navigation, closing background tabs without losing selection, focus return after hide or final close, unique ARIA references for special-character IDs and multiple instances, retained browser/preview DOM and input state, Review's actual execution selection, unknown-diff labeling, matching live tool identity and Activity creation routing. Heavy content bodies are fixtures. These 18 are separate from the 35 tests above.

The final source review identified two integration defects: the right dock covered titlebar actions because the global strip still occupied the full window, and the old home-files visibility rule hid the new Files tab in message-bearing chats. The implementation now publishes actual dock width to the shell's titlebar inset, restores the full strip in bottom/hidden modes, hides conversation controls when the right panel is maximized, and excludes dock files from the legacy hide rule. The strip observer and CSS passed lint/format checks; their final native geometry result belongs in the integration verification below. A jsdom-only selector probe could not evaluate the existing nested `:has`/`:is` rule, so it is not counted as a passing CSS test.

### Material limits

- Web fallback is a sandboxed iframe preview. Its back/forward list records address-bar navigation, not arbitrary cross-origin navigation inside the frame. Sites can refuse embedding; the UI offers external opening. It is not equivalent to desktop browser authentication, downloads or an automated browser tool.
- Native browser UI talks to a dedicated desktop bridge. Frontend tab state alone does not prove native isolation, permission enforcement or agent access; those need the native/security checks recorded separately.
- Opened tabs and their content are retained during hide/select/layout changes in the current mounted chat. They are not persisted to disk or restored after app restart, and real chat changes clear the dock.
- Review is limited to confirmed changes represented in the conversation. Files reuses the current workspace preview. Sidechat and a full IDE editing tree are outside this implementation.

### Native integration verification

Native checks are recorded separately here so current-version rendering, geometry, page loading and platform-specific limitations are not inferred from DOM fixtures.
