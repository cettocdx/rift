# RIFT Cursor-class transformation completion report — 2026-07-18

This report covers the authenticated product transformation on branch
`rift-transformation`, relative to checkpoint `c0d1eef`. The visual contract
was derived from the six supplied Cursor screenshots, the supplied screen
recording, and a live inspection of Cursor 3.12.17. The protected
HackWorkbench is a regression boundary rather than part of the redesign.

## 1. Executive summary

RIFT now presents one restrained, agent-native product shell across Build,
Agents, CLI Workspace, Tasks, Plugins, Studio, Artifacts, Settings, and the
command palette. The former dashboard-like treatments were replaced with
Cursor-matched planar surfaces, native typography, compact controls, and
stable workbench geometry. The Build composer, first-class agent roster and
teams, real PTY workspace, capability management, media flows, and settings
remain connected to their real runtime paths.

The final implementation passed 271 Jest suites and 2,269 tests, TypeScript,
package lint, changed-file formatting, whitespace validation, and a
warning-free 56-page production build. Clean authenticated browser passes on
Home and Workspace ended with no warning/error console entries and no
horizontal overflow. HackWorkbench's three protected source files remain
byte-identical to the checkpoint.

## 2. Architecture changes

- The existing Next.js 16, React 19, Convex, AI SDK, xterm, and optional
  `node-pty` architecture was retained; no parallel mock application was
  introduced.
- `CodexPageShell`, the titlebar, sidebar rail, page surfaces, command palette,
  and semantic theme tokens now form the shared authenticated shell.
- `/agents` is a first-class route backed by the managed agent-roster skill.
  Profile and team schemas are normalized, bounded, serialized, and resolved
  by server-side runtime policy.
- Build and workspace state now isolate route-bound preview state. Workbench
  editor drafts, active files, panel geometry, and terminal scrollback have
  bounded persistence and lifecycle cleanup.
- The local terminal remains a server-only, authenticated PTY bridge. Profile
  discovery is exposed through a gated capability endpoint rather than
  guessed in the client.
- Heavy Monaco code remains lazy. Closed models, terminal listeners, object
  URLs, and agent/browser resources receive explicit cleanup.

## 3. Design-system changes

The shared dark contract uses `#191919` canvas, `#232323` sidebar, `#212121`
composer/user surfaces, `#2e2e2e` selection, restrained `#4c8ed9` focus/status
blue, and one-pixel neutral borders. Active conversation and IDE surfaces use
`#141414` where the reference does.

The UI resolves to San Francisco on macOS through the platform system stack;
code and terminal surfaces use SF Mono/Menlo fallbacks. Default UI text is
13 px, message text is 14 px, the titlebar is 35 px, the standalone sidebar is
272 px, and the empty composer is 608 by 100 px with a 16 px radius. Completed
conversations use a 716 by 42 px follow-up composer. The system avoids glow,
glass, gradients, oversized shadows, and dashboard-card grids. Dark and
semantic light modes share the same geometry and hierarchy.

The exact two-path canonical RIFT mark now drives shared React icons, SVG
assets, favicons, the PWA manifest, and raster app icons. Duplicate pixel-panda
branding was removed from the shared product surface.

## 4. Route-by-route changes

| Surface         | Result                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`             | Sparse Cursor-style New Agent canvas with real repository, agent, execution, model, mode, attachment, command, and submit controls.                |
| `/c/[id]`       | Quiet user surface, unboxed assistant output, compact reasoning and `Worked for` metadata, stable long-thread rows, and route-safe preview state.  |
| `/agents`       | Dedicated roster, catalog, profile creation/editing, permissions, tools, MCP access, skills, and team topology.                                    |
| `/workspace`    | Neutral Cursor-class activity rail, Explorer, Monaco editor, Changes, agent pane, real multi-session PTY, profile detection, and 22 px status bar. |
| `/tasks`        | Dense automation center with honest empty, schedule, run, and status behavior.                                                                     |
| `/plugins`      | Unified Plugins, Skills, and MCP surfaces with real connection/configuration states and no simulated success.                                      |
| `/studio`       | Capability-aware Ask/Agent media generation with model-specific image/video controls.                                                              |
| `/artifacts`    | Real generated-media gallery, accessible preview dialog, metadata, and storage-backed results.                                                     |
| Settings        | Searchable two-column control center for appearance, personalization, keyboard, agents, data, API keys, remote control, and account concerns.      |
| Command palette | Keyboard-first route and action registry with current-context commands.                                                                            |
| `/hack`         | Protected pixels and behavior retained; canonical source hashes match `c0d1eef`.                                                                   |

Marketing components that fabricated a terminal transcript or interactive app
preview were deleted rather than restyled as if they were functional.

## 5. Build workspace changes

- `pnpm dev:cursor` now starts the local Trigger.dev worker beside Next.js.
  Playwright's runtime BiDi mapper is installed and externalized so the worker
  builds cleanly instead of accepting runs that remain queued forever.
- OpenRouter fallback chains are priority-preserving and capped at its current
  three-model API limit. A live GPT-5.6 Sol Agent run completed in 10.6 seconds
  and rendered the exact requested response.
- New chats remain on `/` while streaming. Success uses a real App Router
  replacement only after persistence, keeping the answer visible while loading
  `/c/[id]`; abort, disconnect, startup timeout, and provider errors preserve
  the user's message with Retry/Reconnect actions.
- The composer keeps the task primary while exposing Plan/Agent, model,
  execution target, attachments, slash commands, context, agents, and project
  selection as compact contextual controls.
- Plan mode is non-executing. Server and MCP policy fail closed instead of
  allowing a plan request to cross into state-changing tools.
- Assistant reasoning uses restrained progress verbs and collapses to elapsed
  `Worked for` metadata without exposing private chain-of-thought.
- Preview, Changes, Terminal, Files, Canvas, and agent activity use real panel
  state. Browser back/forward can no longer retain a stale preview from a
  different chat.
- Generated changes retain real diff/editor review paths. Draft buffers are
  restored, dirty navigation is guarded, and destructive project deletion is
  confirmed.
- Long transcripts use 14-message initial and 28-message history pages,
  stable keys/position flags, memoized consumers, and offscreen
  `content-visibility` rather than unbounded eager work.

## 6. Agents and pet system

The six established RIFT pet agents remain available, supplemented by a broad
professional catalog for engineering, review, research, security, QA,
performance, media, and operations roles. `/agents` makes identity, mission,
model, reasoning, task concurrency, permission preset, base tools, exact MCP
servers, repository/folder guidance, memory guidance, autonomy, approvals,
escalation, and skill guidance inspectable.

Custom profiles and teams persist through the managed roster configuration.
Teams expose lead, members, routing, handoff, review ownership, shared context,
and completion behavior. The UI explicitly labels fields that are advisory;
it does not imply a per-agent filesystem, memory store, or approval-resume
engine where none exists.

## 7. Agent skills and orchestration

- The managed `rift-agent-roster` skill is the durable bridge from the UI to
  runtime instructions.
- Exact owner/profile/team identity, model, supported reasoning,
  per-delegation concurrency, base-tool allowlists, and exact MCP server IDs
  are revalidated by the server.
- Read-only profiles use a positive allowlist. Terminal, file writes, preview
  publication/verification, and other state-changing tools are unavailable.
- Unknown custom or team mentions fail closed if the roster cannot be loaded
  or parsed. Built-in compatibility remains only for the verified default
  roles.
- Mention parsing rejects partial identifiers, email-prefix matches, dangling
  punctuation, and similar identity-boundary ambiguity.
- Auto-delegation inherits the current workspace model, and auto-continue
  preserves the resolved profile policy.

## 8. CLI Workspace architecture

The Workspace terminal uses a real `node-pty` process, authenticated session
routes, input leases, resize routes, and an SSE event stream. Multiple named
sessions can be created, selected, split, restarted, closed, and viewed full
screen. Scrollback, manual output, accumulated output, request duration, and
session count are bounded.

Shell, Claude Code, Codex, and Grok are allowlisted profiles. Server-side PATH
detection reports each binary as installed or unavailable; missing profiles
are not passed off as working. The current working directory is canonicalized,
symlink traversal outside the configured root is rejected, and the environment
is built from a narrow allowlist.

Selecting an available Claude Code, Codex, or Grok profile immediately creates
or focuses its real PTY session. `⌘J`/`Ctrl+J` globally opens
`/workspace?terminal=focus`; a live macOS Meta+J pass confirmed the connected
terminal textbox receives focus.

## 9. Claude Code, Codex, Grok, RIFT, and OpenRouter integrations

- Claude Code, Codex, and Grok are native local CLI profiles when their real
  binaries are present. Their availability is rechecked by the server.
- RIFT remains the hosted Build/agent runtime and is not mislabeled as one of
  those native CLIs.
- OpenRouter model selection continues through the existing server-side
  provider path. Agent model/reasoning choices are intersected with supported
  runtime capabilities before execution.
- Provider failures, missing credentials, and unavailable binaries remain
  visible configuration states. No client bundle contains provider secrets.

## 10. Plugins, skills, and MCP changes

Plugins, Skills, and MCP servers now share a dense capability-management
language. Connected, attention-required, unavailable, unsupported, and
configuration-required states come from real data. Skill assignment is
persisted and injected with bounded instruction size.

MCP connection and call timeouts are explicit. Plans cannot cross the MCP
execution boundary, per-profile MCP IDs are intersected with servers owned by
the authenticated user, and read-only profiles receive only tools explicitly
annotated read-only. Credential storage remains server-side and encrypted.

## 11. Media generation improvements

Studio distinguishes Ask from Agent generation and exposes only controls
supported by the selected image or video model. The model catalog now carries
honest capability policy for OpenRouter-backed Veo, Kling, Gemini, GPT Image,
and other configured providers. Media reference URLs travel through the agent
tool context without leaking provider credentials.

Generated images and videos use durable storage helpers rather than ephemeral
display-only URLs. The Artifacts gallery renders actual results and metadata,
and its preview dialog now has a complete accessible description contract.

## 12. Settings and customization

Settings was rebuilt as a compact, searchable, two-column control center.
Appearance supports coherent dark/light themes and interface preferences;
keyboard settings expose discoverable shortcuts and conflict-aware navigation;
agent configuration links to the dedicated route instead of duplicating a
weaker editor. Existing API key, data, remote-control, account, and
personalization persistence is retained.

At 1360×758 the dialog measures 1280×726 after viewport clamping, with a 272 px
navigation rail and 678 px centered content well. At mobile widths navigation
and content stack without document overflow. Search has explicit loading,
results, clear, and zero-match states.

The same settings surface is reachable from the shell, Workspace, keyboard,
and command palette. Dialog focus, Escape, arrow navigation, active category,
and return focus are covered by tests.

## 13. Performance improvements and measurements

An authenticated local production sample measured warm content-ready route
changes at 87 ms, 74 ms, and 46 ms; all three are below the 500 ms budget. The
production server reported ready in 179 ms. The final Home pass had zero
horizontal overflow and no console warnings/errors.

The local-terminal output trace was reduced from 4,867 files to 450; repository
source files in that trace fell from 4,417 to zero. The warning-free build
generated 56/56 pages.

Deterministic tests prove that composer updates do not re-render a 200-row
transcript or API-only consumers, an append preserves 199 historical position
props, a 28-row prepend preserves every loaded key/prop, resize updates
coalesce per animation frame, closed Monaco models are disposed, terminal
scrollback remains at 128 KiB, and drafts remain within 20 documents,
1,000,000 characters per document, and 3,000,000 characters total.

The remaining input-to-paint, resize-frame, terminal-echo, transcript-commit,
and editor-switch p95 targets are documented contracts, not claimed
measurements. See `performance-budgets-2026-07-18.md` for the repeatable suite
and complete hard-limit table.

## 14. Accessibility improvements

- A visible-on-focus skip link reaches the main product region.
- Shell, workbench, composer, terminal, status, navigation, and dialog regions
  have semantic names and state.
- Mobile navigation/tool drawers use a real dialog model with inert
  background, focus entry/trap/return, and Escape support.
- Resizable separators expose value/min/max and keyboard resizing.
- Settings uses keyboard category navigation; editor tabs use roving focus.
- Completed assistant output is announced once through a polite live region,
  rather than announcing every streamed token.
- Icon-only controls have accessible names, active state is not color-only,
  and reduced-motion behavior is preserved.

The targeted performance/accessibility set passed 10 suites and 28 tests.
Manual desktop and mobile browser passes verified landmarks, focusable
controls, responsive dialogs, light/dark themes, and absence of obvious
blocking overflow.

## 15. Security improvements

- Agent identity, ownership, team membership, model, concurrency, tools, and
  MCP access are enforced server-side; the client cannot elevate them.
- Invalid or unavailable custom roster data fails closed for custom/team
  mentions.
- Plan mode and read-only profiles are prevented from reaching state-changing
  tool paths.
- Local-terminal root and CWD resolution reject relative roots, traversal, and
  symlink escape. Runtime filesystem discovery is excluded from Next output
  tracing without weakening these checks.
- Terminal environment values, executable profiles, request sizes, output
  sizes, and timeouts are allowlisted or bounded.
- MCP credentials and provider secrets remain server-side; URL and error
  redaction/security tests remain green.
- Preview state cannot leak across chat routes, and generated media storage
  rejects unsafe persistence behavior.

The independent security group passed 33 suites and 366 tests.

## 16. Tests added and results

| Gate                        | Result                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Full Jest                   | 271/271 suites, 2,269/2,269 tests                                                            |
| Production build            | Exit 0, warning-free, 56/56 pages                                                            |
| TypeScript                  | `pnpm typecheck` passed                                                                      |
| Package lint                | `pnpm lint` passed                                                                           |
| Extended lint audit         | 0 errors; one pre-existing warning in `convex/auth.config.ts`                                |
| Changed-file Prettier       | Passed                                                                                       |
| Whitespace                  | `git diff --check` passed                                                                    |
| Hack regression             | 6 suites, 42 tests passed                                                                    |
| Security group              | 33 suites, 366 tests passed                                                                  |
| Performance + accessibility | 10 suites, 28 tests passed                                                                   |
| Browser console             | Fresh Home, Workspace, Studio, Plugins, Artifacts, and Notebook passes: zero warnings/errors |

Playwright discovered 173 end-to-end cases, but the authenticated external E2E
suite was not executed because `.env.e2e` and its real test users/services are
not present. Critical local workflows were instead exercised through the
authenticated in-app browser plus integration tests: primary navigation,
Settings, command palette, agent/team dialogs, light/dark mode, mobile modal,
Artifacts preview, real Explorer hydration, PTY connection, CLI profile state,
and protected HackWorkbench.

Protected source hashes:

- `app/hack/page.tsx`: `85a695870ca7e0ab...`
- `app/components/HackerMode.tsx`: `c719f9ed8d5a040c...`
- `app/api/hack-chat/route.ts`: `7cace86ecc339dd1...`

## 17. Remaining external configuration requirements

- Populate `.env.e2e`, create isolated test users, and configure the external
  auth/Convex services before running the full Playwright matrix.
- Provider API keys and accounts are required for live OpenRouter, image, and
  video generation calls.
- Claude Code, Codex, and Grok must be installed on the host for their native
  terminal profiles to report available.
- GitHub, Stripe, MCP OAuth/token flows, storage, deployment, and other plugins
  require their real credentials and callback configuration.
- Local PTY access is intentionally enabled only with
  `RIFT_LOCAL_TERMINAL=1` and an absolute `RIFT_LOCAL_WORKSPACE_ROOT`.

## 18. Known limitations

- The five interaction p95 budgets beyond warm routing still need a dedicated
  production browser trace; deterministic invariant tests are not presented as
  wall-clock benchmarks.
- Transcript rendering is paginated and offscreen-optimized, not a fully
  virtualized variable-height list. Explicitly loading thousands of history
  pages will still grow the DOM.
- Repository/folder, memory, autonomy, approval, escalation, and skill fields
  are advisory until RIFT has per-profile filesystem/memory and resumable
  approval infrastructure.
- The authenticated Playwright suite and paid image/video provider calls remain
  an external-environment gate as described above. The primary OpenRouter Agent
  path was exercised live and completed successfully.
- Jest's repository-wide coverage thresholds are still configured at zero;
  this transformation added regression depth but did not invent a percentage
  gate without a measured baseline.
- The repository-wide `pnpm format:check` still includes historical/generated
  material outside this change set; every changed text file passes Prettier.
- The visible local zsh prompt currently includes the host's inherited `192%`
  prompt text. RIFT reports it honestly rather than rewriting terminal output.

## 19. Files and migrations changed

The change set is intentionally grouped around product surfaces:

- Shell/design: `app/globals.css`, `app/layout.tsx`, `app/components/pro/*`,
  sidebar components, theme provider, shared page shell, icons, manifest, and
  raster assets.
- Build/runtime: ChatInput, Messages, MessageItem, chat navigation/handlers,
  preview panels, reasoning components, agent stream/chat policy, and tool
  registration.
- Agents: `/agents`, `AgentsWorkbench`, profile/team dialogs, pet roster,
  managed-skill persistence, runtime policy, delegation, and tests.
- Workspace: Workbench shell/editor/Explorer/Changes/terminal components,
  draft persistence, terminal contracts, local PTY adapter, authenticated API
  routes, profile discovery, and tests.
- Capabilities: Plugins, MCP catalog/client/policy, Skills, media model/tools,
  generated-media storage, Studio, Artifacts, Tasks, Settings, Appearance,
  Keyboard, and accessibility helpers.
- Evidence: baseline screenshots, reference research, Cursor UI forensics,
  performance budgets, and this report.

`AppPreview.tsx` and `TerminalLive.tsx` were removed because they represented
fabricated marketing behavior. No Convex schema or database migration was
required; existing durable stores and managed-skill records remain compatible.

## 20. How to run and verify

Install and launch the Cursor-skinned development surface:

```sh
cd /Users/cetto/Developer/rift-cursor
pnpm install
pnpm dev:cursor
```

Open `http://localhost:3014`. The script enables the localhost PTY bridge,
sets the repository as its absolute workspace root, and starts the local
Trigger.dev worker required by Build Agent runs.

Run the local quality gates:

```sh
pnpm typecheck
pnpm lint
pnpm exec jest --ci --runInBand
pnpm build
git diff --check
```

For a production-profile build beside development:

```sh
RIFT_NEXT_DIST_DIR=.next-cursor-build pnpm build
RIFT_NEXT_DIST_DIR=.next-cursor-build \
  RIFT_UI_SKIN=cursor \
  RIFT_LOCAL_TERMINAL=1 \
  RIFT_LOCAL_WORKSPACE_ROOT=/Users/cetto/Developer/rift-cursor \
  NEXT_PUBLIC_BASE_URL=http://localhost:3015 \
  NEXT_PUBLIC_APP_URL=http://localhost:3015 \
  pnpm exec next start -H localhost -p 3015
```

Baseline images are under `artifacts/runtime-baseline/2026-07-18/`. The exact
visual contract is recorded in `cursor-ui-forensics-2026-07-18.md`; the
performance release contract and repeatable invariant command are in
`performance-budgets-2026-07-18.md`.
