# Project Bots Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task.

**Goal:** Deliver the approved persistent project bots, connected marketplace, meetings and quiet launch experience.

**Architecture:** Convex owns bots and conversation bindings. Existing chat transports and runtime policy execute bot work; existing tasks remain the scheduler. Registry discovery extends existing verified MCP connection flows.

**Tech Stack:** Next.js, React, Convex, Trigger.dev, Vercel AI SDK, existing desktop shell.

## Global Constraints

Preserve existing dirty work. Never fake Connected, bot responses or run status. Default to written meetings. Bots do not start when merely added. Project/owner validation is server-side. Normal chat and CLI remain compatible.

### Task 1: Persistent project bots

Files: convex/schema.ts, convex/projectBots.ts, lib/ai/agents/project-bot-templates.ts, lib/projects/project-runtime.ts, lib/ai/agents/runtime-policy.ts, trigger/agent-long.ts, lib/api/chat-handler.ts; related tests.

- [x] Add typed role templates and a profile snapshot; reuse CustomAgentProfileConfig rather than inventing a second policy.
- [x] Add project_bots indexed by owner/project and chat, with name, mission, snapshot, archived_at and chat_id. Create bot and chat atomically. Repeated open returns the same chat.
- [x] Test foreign/archived project denial and independent project profiles with mocked Convex transactions.
- [x] Resolve persisted chat→bot→project binding in project-runtime. Only the trusted backend lookup supplies the profile to resolveAgentRuntimePolicy.
- [x] Test profile precedence and no cross-project lookup; run Jest targeted and TypeScript.

### Task 2: Bot workspace

Files: app/components/agents/ProjectBotsWorkbench.tsx, BotAvatar.tsx, project-bots.module.css, app/(chat)/agents/page.tsx, SidebarProjects.tsx.

- [x] Default Agents to project selector + compact roster. Keep existing profile catalog in an explicit advanced view.
- [x] Add template picker, persisted edit, open-conversation and archive actions. Bind navigation to /c/{chat_id}, reusing retained chat.
- [x] Show actual role, editable skills and model, no decorative fake activity.
- [x] Test empty/project creation/loading/error interactions and inspect light/dark layouts.

### Task 3: Tasks and written meetings

Files: convex/tasks.ts, schema.ts, lib/tasks dispatch, bot workspace and focused meeting modules.

- [x] Add optional owner-checked project/bot assignment to existing tasks and trusted dispatch.
- [x] Create meeting with 2–6 selected project bots, persistent conversation and agenda. Use bounded real delegation with participant provenance and existing worker execution.
- [x] Reuse schedule/claim semantics for timed meetings; no browser timers.
- [x] Test duplicate dispatch, unauthorized participants, archived bot, partial failure and final output.

### Task 4: Marketplace

Files: lib/ai/mcp registry adapter, app/api/mcp discovery route, McpMarketplace and tests.

- [x] Fetch only official Registry metadata, latest active supported remote entries, cursor limits and caching; retain curated defaults during outage.
- [x] Route selected dynamic entries through trusted server resolution and existing endpoint/auth checks.
- [x] Compact equal-size logo rows and honest Connect/Set up/Connected states.
- [x] Verify malformed records, old versions, failures, provider auth, cancellation and duplicate listing.

### Task 5: Launch

Files: components/launch and packages/desktop/scripts launch generator/template, tests.

- [x] Quiet logo and meaningful status; remove decorative delay and oversized mark.
- [x] Keep native HTML/React handoff consistent, traffic-light space and drag area.
- [x] Verify generated artifact parity and light/dark/reduced-motion.

### Task 6: Integration

- [x] Generate Convex types; deploy additive dev schema/functions only after local checks.
- [x] Run targeted suites and tsc; inspect actual UI Preview and data-backed bot round trip.
- [x] Record measured results and any unverified provider integrations. No parity/speed claim without measurement.

## Integration follow-up

- [x] Live-test Run now for a saved bot task after deploying the new durable manual occurrence endpoint.
- [x] Record final affected tests and the manual run outcome.

Native launcher packaging and long-session production performance parity are not claimed by the preview smoke tests; detailed limits are in docs/audits/2026-09-09/project-bots-verification.md.
