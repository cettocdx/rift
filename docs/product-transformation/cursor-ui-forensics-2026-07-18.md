# Cursor UI forensics — 2026-07-18

This is the visual implementation contract for Rift's authenticated product
surface. It was derived from the supplied Cursor screenshots and 48.53-second
screen recording supplied on the Desktop, then checked against the live Cursor
3.12.17 application. The protected `/hack` workbench is explicitly outside
this contract.

## Evidence set

- `Screenshot 2026-07-18 at 19.46.27.png` — New Agent / empty state
- `Screenshot 2026-07-18 at 19.46.33.png` — model picker
- `Screenshot 2026-07-18 at 19.46.43.png` — account popover
- `Screenshot 2026-07-18 at 19.46.54.png` — Automations
- `Screenshot 2026-07-18 at 19.46.57.png` — Customize
- `Screenshot 2026-07-18 at 19.48.09.png` — IDE workspace
- `Screen Recording 2026-07-18 at 19.47.14.mov` — active agent,
  reasoning, tool rail, split panes, terminal/CLI, and fullscreen transitions
- Live Cursor window captured at 19:58 — conversation + Browser split

The screenshots are Retina captures. Measurements below are CSS/logical
pixels unless explicitly called out as source pixels.

## Visual tokens

| Token                     | Dark value | Use                                      |
| ------------------------- | ---------- | ---------------------------------------- |
| `--cursor-canvas`         | `#191919`  | standalone main canvas                   |
| `--cursor-chat-canvas`    | `#141414`  | active conversation / IDE dark canvas    |
| `--cursor-sidebar`        | `#232323`  | standalone repository/navigation sidebar |
| `--cursor-surface`        | `#212121`  | composer, user message, compact cards    |
| `--cursor-surface-hover`  | `#2a2a2a`  | hover and open controls                  |
| `--cursor-selection`      | `#2e2e2e`  | selected navigation row/tab              |
| `--cursor-popover`        | `#1b1b1b`  | menus and model picker                   |
| `--cursor-border`         | `#303030`  | panel and input hairlines                |
| `--cursor-border-strong`  | `#383838`  | focused/raised input hairline            |
| `--cursor-text`           | `#d8d8d8`  | primary interface text                   |
| `--cursor-text-secondary` | `#a1a1a1`  | descriptions and inactive controls       |
| `--cursor-text-faint`     | `#717171`  | timestamps, metadata, placeholders       |
| `--cursor-blue`           | `#4c8ed9`  | focus and rare status signal only        |
| `--cursor-green`          | `#4aa878`  | additions/success                        |
| `--cursor-red`            | `#df5b67`  | errors/deletions                         |
| `--cursor-warning`        | `#d5a84f`  | needs-attention state                    |

Direct pixel checks from the reference capture confirmed `#191919` for the
empty main canvas, `#232323` for the standalone sidebar, `#2e2e2e` for the
selected New Agent row, and `#212121` for the composer. The live application
confirmed `#141414` for the active chat canvas and `#212121` for both the user
message and follow-up composer.

Light mode remains supported for Rift accessibility/preferences, but it is a
semantic inversion of this system rather than a separate visual direction.

## Type system

- UI stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
  On macOS this resolves to San Francisco, matching the live Cursor surface.
- Code/terminal stack: `"SFMono-Regular", Menlo, Monaco, Consolas,
"Liberation Mono", monospace`.
- Default UI size: `13px`, line-height `19.5px`.
- Message body: `14px`, line-height `20px`.
- Navigation rows and metadata: `12–13px`, never uppercase except compact
  section labels.
- Page heading: `20px/26px`, semibold. Dialog heading: `16px/22px`.
- Weight range is restrained: 400 body, 500 controls, 600 headings. No display
  font and no decorative tracking in the product shell.

## Geometry

| Surface             | Contract                                                     |
| ------------------- | ------------------------------------------------------------ |
| Top/title bar       | `35px` high; one hairline bottom border                      |
| Standalone sidebar  | `272px` reference width; collapses into a mobile dialog      |
| Sidebar row         | `28–32px` high, `8px` radius, `8–10px` horizontal inset      |
| Main content well   | centered; `940px` maximum for list/configuration pages       |
| Conversation column | `716px` follow-up reference; narrows fluidly with viewport   |
| Empty composer      | `608×100px` at 1360×758, `16px` radius                       |
| Follow-up composer  | `716×42px` at 1360×758, `14px` radius                        |
| User message        | full conversation width, `10–12px` radius, `12px 14px` inset |
| Popover/model menu  | `248px` wide, `10px` radius, 1px border                      |
| Tool tabs           | `35px` strip; selected item is a quiet rounded surface       |
| IDE activity rail   | `40–44px`; explorer `218–240px`; status bar `22px`           |

The main layout is always planar: no glow, gradient, glass, oversized shadow,
or dashboard-card composition. Separation comes from adjacent neutral values
and one-pixel borders.

## Interaction language

### New Agent

The empty state is intentionally sparse. Repository/context selectors sit one
line above the composer. The composer contains the prompt, attachment action,
model selector, and voice/send action. Secondary prompts are small pills below.
Operational metrics remain available through real routes and sidebar status,
but must not turn the New Agent canvas into a dashboard.

### Conversation and reasoning

- User prompts are quiet bordered surfaces spanning the conversation column.
- Assistant output is unboxed text.
- In-progress reasoning is a muted verb phrase such as `Planning next moves`.
- Completion collapses to muted elapsed metadata such as `Worked for 8s`.
- Feedback, branch, and copy controls sit right-aligned beneath the response and
  become prominent on hover/focus.
- The generating control is a square stop glyph inside a light circular button.

### Tools and split panes

The right-side activity rail exposes real Changes, Browser, Terminal, and Files
state. Opening a tool creates a true resizable split. Its tab strip supports
Changes, Terminal, Browser, Canvas, Side Chat, and available CLI sessions. The
split can expand, collapse, and become fullscreen without discarding chat or
terminal state.

### Configuration screens

Automations maps to Tasks; Customize maps to Plugins, MCPs, Skills, Agents,
Rules, Commands, and Hooks. These routes use a centered `940px` content well,
20px headings, compact pill tabs, and long list/table surfaces with thin row
dividers. Counts, readiness, errors, and install state must come from real data.

## Rift route mapping

| Cursor reference                                | Rift surface                         |
| ----------------------------------------------- | ------------------------------------ |
| New Agent                                       | `/` Build empty state                |
| conversation + action rail                      | `/c/[id]` + agent activity/tool pane |
| Automations                                     | `/tasks`                             |
| Customize / Plugins / MCPs / Skills / Subagents | `/plugins` + `/agents`               |
| IDE                                             | `/workspace`                         |
| Browser / Terminal / Files / Changes            | Build tool pane and workspace panels |
| account popover                                 | sidebar user menu + Settings         |

## Non-negotiable verification

1. At 1360×758, the shell has a 35px titlebar, a 272px sidebar, and a sparse
   New Agent surface with a 608×100px composer.
2. At mobile widths, navigation and tool panes behave as modal dialogs with
   focus entry/trap/return and Escape support.
3. Keyboard users can resize a visible split and receive current/min/max values.
4. Completed assistant content is announced once by assistive technology.
5. `/workspace` uses the same neutral token family; no residual blue-gray IDE
   palette remains.
6. `/hack` remains visually and behaviorally unchanged.
