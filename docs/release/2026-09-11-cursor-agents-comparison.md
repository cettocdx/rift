# Cursor Agents comparison — 2026-09-11

Reference: the running macOS **Cursor Agents** window at `/Volumes/Cursor Installer/Cursor.app`. The IDE button was not used. RIFT comparison used `/Applications/RIFT UI Preview.app`, serving the release preview on port 3020. This is an interaction inspection, not a same-workload frame-rate benchmark or access to Cursor's proprietary harness.

## Directly exercised

- Opened model parameters and the Effort submenu without changing the existing task's settings.
- Opened New Chat using Cmd+N, typed `/`, inspected keyboard-accessible command/skill suggestions, and cleared the draft without submitting.
- Opened the agent/context/tools addition palette (Plan, Debug, Multitask, Ask, Files, Model, MCP).
- Returned to the existing task, observing grouped operations, child-agent status, final response, and the Apps rail. The existing task completed independently during inspection; no Stop, approval, or send action was used.
- Opened RIFT's effort control and reproduced the disappearance of the selected model control.

## Observations and implementation boundary

| Surface           | Observed Cursor Agents behavior                                                              | RIFT action/status                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Model / effort    | Model, context and effort are grouped; the trigger stays visible                             | Removed RIFT model hiding during effort interaction. Full consolidation remains a separate UI change.                      |
| Focus / scrolling | Menus are anchored to their controls                                                         | RIFT selected-row reveal now scrolls only the menu. Pending focus is cancelled when closing.                               |
| Commands          | Searchable `/` list with short descriptions and a separate selected-item explanation         | RIFT already has a composer palette; deeper command parity remains to audit.                                               |
| Transcript        | Compact operation groups interleaved with prose; final answer and changes follow             | RIFT has operation groups; long mixed-output comparison remains pending.                                                   |
| Apps              | A quiet right-side list exposes Changes, Desktop, Browser, Terminal and Files                | RIFT workspace tabs remain; equivalent panel transitions require further measurement.                                      |
| Color             | Rendered content/titlebar sample #191919; sidebar #232122; composer #212121; divider #2f2d2e | These are screen samples, not source-exact CSS values. Old IDE palette claims must not stand in for this Agents reference. |

The screenshot was 1204×756. Color samples came from unobstructed points of `/tmp/rift-cursor-agents-reference.png`; monitor/profile conversion can affect them. No inference is made that UI similarity establishes equal reliability, latency, accessibility or model quality.

## Verification

- The original hide-on-effort behavior failed 2 regression assertions. The old ancestor-scrolling focus behavior failed 3 geometry/focus cases.
- Focused component suite: 21 tests passed before final verification; see `/tmp/rift-cursor-controls-green.log`.
- The browser fixture imports the production toolbar and Radix controls. It checks desktop/mobile geometry, preserved draft, visible model while adjusting effort, focused selected model, no document scroll, and bounded menu placement on Chromium/WebKit. Final results: `/tmp/rift-cursor-composer-browser.log`.

Harness research is separately recorded in `/Users/cetto/RIFT-Reports/2026-09-11-harness-primary-research.md`. Published Cursor patterns support discoverable context and durable execution; using its desktop UI does not disclose the private implementation.

## September 12 follow-up

Used the same native Cursor Agents window and existing completed conversation,
without entering IDE or submitting work. Dismissed the image viewer with Escape,
returned to the mixed-image transcript, and expanded/collapsed the Apps list.
The compact rail exposes the same destinations while allowing more transcript
width. Collapsing it visibly reflows and enlarges images; the observation is not
evidence of zero layout movement or a measured frame-time advantage.

RIFT's next isolated regression uses the actual Messages/scroll components:
closing a 401-line streamed code fence discarded Wrap and moved a visible source
line by 800 pixels in WebKit. Preserving that reading state is a concrete UX
requirement derived from direct use, independent of matching colors. A broader
mixed-media/real-dock comparison remains outstanding.
