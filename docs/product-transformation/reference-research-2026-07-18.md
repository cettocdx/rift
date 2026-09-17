# Rift product reference research

Research date: 2026-07-18

This document records product patterns to adapt for Rift. It is not a visual cloning brief. Brand assets, proprietary illustrations, and source code from reference products are out of scope.

## Design read

Rift is a desktop-first, agent-native development workbench for professional developers and security teams. The target language is restrained, precise, calm, information-dense, keyboard-friendly, and native-feeling. The intended design dials are:

- Design variance: 4/10. Stable workbench geometry with controlled asymmetry only when it improves focus.
- Motion intensity: 3/10. Fast state feedback and panel transitions, no decorative choreography.
- Visual density: 9/10. Compact controls, strong hierarchy, and line-based grouping rather than card grids.

The UI Pro Max database returned a developer palette and IBM Plex Sans plus JetBrains Mono, but its marketing-page layout recommendations were incompatible with this product. Rift will preserve the existing platform-native UI stack, project-local typography, semantic tokens, and one blue signal accent.

## Primary sources

### Cursor

- Changelog, current through 2026-07-17: https://cursor.com/changelog
- Cursor 3.11, Side Chats and Conversation Search: https://cursor.com/changelog
- Cursor 3.2, Multitask, Worktrees, and Multi-root Workspaces: https://cursor.com/changelog/04-24-26
- Cursor CLI agent modes and cloud handoff: https://cursor.com/changelog/cli-jan-16-2026
- Cursor CLI reference and MCP/rules behavior: https://cursor.com/docs

Current public patterns:

- Agents Window is a first-class surface, separate from the editor but connected to local and cloud execution.
- Side chats preserve a main run while supporting read-focused investigation and later at-mention handoff.
- Conversation search is available from the command palette and within the active transcript.
- Project and repository selection is scoped by execution location: local computer, cloud, or remote machine.
- Multi-root workspaces and worktrees are visible workflow concepts, not hidden implementation details.
- Background work reports plan and progress before completion.
- CLI supports Ask and Plan modes, cloud handoff, word-level diffs, and an interactive MCP menu.
- Customize consolidates plugins, skills, MCP servers, subagents, rules, commands, and hooks with user, team, and workspace scopes.
- Agent artifacts include screenshots, logs, demos, source-control changes, and review actions.

### OpenAI Codex

- Codex product and plan overview: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- Plugins in Codex: https://help.openai.com/en/articles/20001256-plugins-in-codex
- Skills in ChatGPT and Codex: https://help.openai.com/en/articles/20001066-skills-in-chatgpt
- Codex developer resources: https://developers.openai.com/codex

Current public patterns:

- The desktop app is a command center for parallel agents across projects.
- Worktrees isolate tasks and support focused diff review before merge or handoff.
- Skills and automations are reusable runtime capabilities, not decorative labels.
- Plugins package skills and connected apps while inheriting source-system and workspace permissions.
- Local and cloud execution have distinct permission surfaces.
- Browser developer mode exposes deeper console, network, DOM, and performance inspection only with explicit permission.
- Agent activity communicates progress and decisions without exposing private reasoning.

### Claude Code

- Current CLI reference: https://code.claude.com/docs/en/cli-usage
- MCP configuration: https://code.claude.com/docs/en/mcp
- Permissions: https://code.claude.com/docs/en/permissions
- Subagents: https://code.claude.com/docs/en/sub-agents
- Hooks: https://code.claude.com/docs/en/hooks

Current public patterns:

- Sessions can be continued or resumed by identifier and can add additional working directories.
- Permission modes are explicit, named, and switchable; bypass modes carry prominent warnings.
- Background sessions have list, log, stop, restart, and remove operations.
- MCP authentication and management are first-class CLI commands.
- Custom agents, plugins, advisors, and tool allow/deny lists are configuration concepts.
- Diagnostics are read-only by default and separate from repair actions.

### Visual Studio Code

- Workbench settings: https://code.visualstudio.com/docs/configure/settings
- Profiles: https://code.visualstudio.com/docs/configure/profiles
- Terminal profiles: https://code.visualstudio.com/docs/terminal/profiles
- Terminal advanced behavior: https://code.visualstudio.com/docs/terminal/advanced
- Terminal appearance: https://code.visualstudio.com/docs/terminal/appearance

Current public patterns:

- Settings have user, workspace, folder, remote, profile, and language scopes with visible precedence.
- Settings search supports filters for modified, extension, feature, workspace trust, accessibility, advanced, preview, and experimental options.
- Profiles are createable, switchable, exportable, importable, and synchronizable.
- Terminal profiles expose shell, arguments, environment, working directory, safety warnings, and profile-specific shortcuts.
- Workbench actions are reachable from UI, keyboard shortcuts, context menus, and command palette.
- Unsafe executable settings cannot be silently accepted from an untrusted workspace.

### Linear, JetBrains, Warp, Raycast, and GitHub Desktop

Primary references:

- Linear product concepts and command menu: https://linear.app/docs/conceptual-model
- Linear search: https://linear.app/docs/search
- Linear desktop app: https://linear.app/docs/get-the-app
- JetBrains terminal settings: https://www.jetbrains.com/help/idea/settings-tools-terminal.html
- Warp documentation: https://docs.warp.dev
- Raycast manual: https://manual.raycast.com
- GitHub Desktop documentation: https://docs.github.com/en/desktop

Useful patterns:

- Linear exposes the same action through buttons, shortcuts, contextual menus, and command search. Undo is broadly available.
- Linear command results are context-sensitive and prioritize actions for the current view and selection.
- Desktop clients benefit from native notifications, tab support, reduced shortcut conflicts, and predictable offline or recovery states.
- JetBrains separates terminal engines, project settings, application settings, keymaps, shell integration, command completion, contrast enforcement, and cursor behavior.
- Raycast favors fast fuzzy navigation, predictable empty and error states, immediate focus, and concise metadata.
- Warp treats commands and their output as addressable execution units while preserving a real shell process.
- GitHub Desktop keeps destructive Git actions explicit and makes branch, history, conflict, and publish state legible.

## UI anatomy to adapt

### Global shell

1. Compact activity rail for stable top-level destinations.
2. Contextual primary sidebar for projects, sessions, and recent work.
3. Title and tab bar with repository, branch, execution target, and model context.
4. Main editor, chat, or route surface.
5. Optional right inspector for agent, preview, changes, or metadata.
6. Resizable bottom panel for terminal, output, problems, ports, tests, and logs.
7. Thin status bar for branch, execution, permissions, background work, and connectivity.

Panel visibility, widths, and active tabs should persist. Dividers require keyboard alternatives and double-click reset. Mobile should prioritize one pane at a time instead of shrinking the desktop cockpit.

### Agent workspace

- Agent roster and teams live in a dedicated route.
- Agent configuration distinguishes identity, role, mission, model, autonomy, permissions, tools, skills, integrations, repositories, folders, memory, concurrency, escalation, and approval behavior.
- Running, waiting, blocked, failed, paused, and completed are explicit states.
- Activity is structured into inspectable events with elapsed time, commands, files, agents, skills, retries, and errors.
- Pet characters provide identity and lightweight status animation, while professional text controls remain primary.
- Team topology, shared context, reviewer ownership, handoffs, conflicts, and completion criteria are visible.

### Build workspace

- Composer keeps task text primary and moves model, effort, mode, permissions, attachments, skills, agents, and execution target into compact contextual controls.
- Plan mode is read-only and remains visible as execution proceeds.
- Side investigations do not interrupt the main run.
- Diff review, preview, terminal, test output, and problems are first-class panes, not long chat attachments.
- Follow-ups can queue, edit, reorder, retry, branch, or stop without losing history.

### CLI workspace

- Real PTY-backed sessions, not fabricated terminal cards.
- Multiple named sessions with resume, restart, stop, split, full screen, search, and history.
- Coding-agent launchers clearly report installed, missing, configured, unavailable, or provider-adapter status.
- Provider, model, working directory, repository, permissions, and approval mode remain visible.
- Native CLIs and Rift adapters are never presented as the same product.

### Customize and settings

- Plugins, skills, MCP, rules, commands, hooks, agent templates, and workspace extensions share one capability-management information architecture.
- Implementation states are explicit: installed, available, update, configuration required, unavailable, planned, and unsupported.
- Settings use search, category navigation, scope, modified state, reset, and clear descriptions of consequences.
- Permission presets expand into exact capabilities and warnings.
- Keyboard shortcuts support search, conflict detection, reset, and import/export.

## Interaction patterns

- One action model: primary UI, context menu, shortcut, and command palette invoke the same command registry.
- Keyboard focus follows visual order; panels and dialogs restore focus after close.
- Hover is subtle color change. Pressed state is immediate. Motion never delays input.
- Optimistic updates are used only when failure can be rolled back safely.
- Persistent failures remain inline. Toasts are limited to transient acknowledgement.
- Destructive actions show the exact target, consequences, and recoverability.
- Background work can be paused, stopped, inspected, and resumed independently.
- Long lists and transcripts use incremental rendering or virtualization.

## Keyboard behavior

- `Cmd/Ctrl+K`: context-aware command palette.
- `Cmd/Ctrl+P`: file/project quick open where relevant.
- `Cmd/Ctrl+,`: settings.
- `Cmd/Ctrl+B`: toggle sidebar.
- `Cmd/Ctrl+J`: toggle bottom panel.
- `Cmd/Ctrl+Shift+F`: workspace search.
- `Cmd/Ctrl+Enter`: submit or confirm the primary safe action.
- `Escape`: close the top transient layer, stop a selection mode, or return focus.
- Arrow keys navigate menus, rosters, trees, and result lists without moving focus unpredictably.
- `?`: searchable shortcut reference when focus is not in an editable control.

Shortcut handling must respect terminal and editor focus, international layouts, and browser-reserved combinations.

## State and feedback patterns

Every workflow needs initial, hover, focus, pressed, selected, disabled, loading, streaming, empty, partial, success, warning, error, offline, rate-limited, permission-denied, auth-required, configuration-required, retrying, cancelled, and timed-out behavior.

Errors should name:

1. What failed.
2. The likely cause when known.
3. Whether work was preserved.
4. Whether retry is safe.
5. The next actionable step.

## Accessibility observations

- All icon-only controls need an accessible name and tooltip.
- Workbench regions require landmarks, headings, and labels.
- Active, selected, status, and diff meaning cannot rely on color alone.
- Dialogs and mobile drawers trap focus and restore it after close.
- Terminal and editor shortcuts need documented focus escape behavior.
- Agent progress should use polite live announcements for state transitions, not every streamed token.
- Motion and auto-updating content must respect reduced-motion and user pause preferences.
- Both light and dark themes must meet WCAG AA for text, focus, inputs, and status colors.

## Adapt, do not copy

- Adapt Cursor's separation of agents, local/cloud execution, review artifacts, and scoped project pickers.
- Adapt Codex's parallel worktree model, reusable skills, permission inheritance, and inspectable progress.
- Adapt Claude Code's explicit session lifecycle, permission modes, and diagnostics.
- Adapt VS Code's proven workbench geometry, settings scopes, terminal profiles, and command system.
- Adapt Linear's unified action registry and keyboard muscle memory.
- Keep Rift's canonical HackWorkbench logo, build/media/security workflows, agent pets, real PTY bridge, and provider breadth.
- Do not copy reference brand colors, marks, proprietary illustrations, marketing copy, or source code.

## Rift-specific opportunities beyond the references

- A professional pet-agent world that makes persistent agent identity and team topology legible without obscuring permissions or task state.
- Security-first execution policies shared across Build, CLI, plugins, MCP, and HackWorkbench.
- One capability graph connecting agents, skills, plugins, MCP tools, repositories, models, and permission scopes.
- Unified evidence bundles containing plan, activity, commands, diffs, tests, screenshots, generated media, and deployment state.
- Cross-surface handoff between Build, CLI, Agents, Studio, and HackWorkbench with preserved project and repository context.
- Capability-aware media forms that expose only controls supported by the selected model.
- Clear provider truth: native CLI, hosted provider, local adapter, and unavailable integration are always distinct.

## Immediate implementation implications

- Protect `/hack` and all of its internal components. Only shared-shell compatibility and canonical logo changes are permitted.
- Promote Agents from a settings subsection to a top-level route while preserving the existing runtime-backed crew configuration.
- Consolidate the shell navigation and command registry so route, shortcut, context, and command-palette actions stay aligned.
- Preserve the real PTY-backed `/workspace` implementation and improve session management rather than replacing it with simulated output.
- Expand Settings into searchable categories with explicit scope and consequence descriptions.
- Keep one blue signal accent, compact radii, line-based grouping, native UI typography, and semantic light/dark tokens.
