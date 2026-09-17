# RIFT — UI/UX Master Redesign and Implementation Specification

**Product:** riftsys.app  
**Document type:** UI/UX redesign, product-logic correction, agent experience and implementation master brief  
**Audience:** Codex, Claude Code, Cursor, product designer, frontend engineer, backend engineer and QA  
**Priority:** Make RIFT trustworthy, understandable, reviewable and reversible before adding more models or capabilities.

---

## 0. How to use this document

This document is both:

1. A complete product/UI/UX specification for fixing the current application.
2. An implementation brief containing priorities, acceptance criteria and test scenarios.
3. A ready-to-paste master prompt for Codex or Claude Code at the end of the file.

Do not implement every item as one uncontrolled rewrite. First inspect the repository, current routes, shared components, state management, database schema and existing tests. Then execute the work in the ordered phases defined here. Preserve working behavior and unrelated user changes.

---

# 1. Executive product decision

RIFT currently presents several products inside one shell:

- Coding/build agent
- IDE/workspace
- Multi-agent orchestration platform
- Media generation studio
- Security testing workbench
- Scheduled automation system
- Plugin/skill marketplace

The breadth is valuable, but the user does not have one stable mental model for how these pieces relate.

The new product model must be:

> **Project → Run → Agent or Team Execution → Evidence and Outputs → Review → Accept, Roll back or Export**

Every RIFT surface must use this same model.

- Build produces code changes, test results, previews and deployment outputs.
- Studio produces media assets, variants and generation receipts.
- Hack produces findings, command evidence and reports.
- Tasks create scheduled Runs.
- Agents and Teams execute Runs.
- Skills and Plugins are capabilities used by Runs.
- Artifacts are outputs created by Runs.

Do not use chat as the primary product object. Chat is the conversation attached to a Run or Project.

---

# 2. North-star experience

The target user experience is:

1. The user selects or creates a Project.
2. The user describes an outcome.
3. RIFT makes the execution scope, agent/team, model, permissions and estimated cost understandable.
4. The Run begins and shows meaningful phases rather than an unstructured stream.
5. The user can inspect live terminal activity, tool calls, files, browser preview, evidence and costs.
6. The user can stop safely and receives immediate acknowledgement.
7. The Run remains accessible after navigation, refresh, logout or reconnect.
8. Completion is proven with changes, tests, screenshots, findings or generated assets.
9. The user reviews the result and can accept, reject, partially accept, retry or roll back.
10. The entire Run can be shared or exported as a durable receipt.

The product promise must become:

> Give RIFT a job. Watch it work. Inspect the proof. Keep or roll back the result.

---

# 3. Non-negotiable requirements

## 3.1 Trust and reliability

- A Run must never disappear because the user navigated away.
- A refresh must reconstruct the Run from persisted events.
- Stop must transition visibly through `stopping` to `cancelled`, `completed` or `failed`.
- Every terminal command must have start time, end time, command, working directory, exit code, stdout/stderr references and status.
- Evidence must be immutable or versioned after capture.
- Partial output must survive failure or cancellation.
- Every important destructive or external action must show the effective approval policy.
- The UI must never claim `Ready`, `Connected`, `Completed` or `Verified` when the underlying state is unknown or degraded.

## 3.2 Reviewability

- Code changes require file and hunk-level diff review.
- The user must be able to accept/reject individual files or hunks.
- Each meaningful Run phase creates a checkpoint.
- Restore must clearly explain whether it reverts files, conversation state or both.
- Build completion requires tests/build/preview evidence or an explicit explanation of why verification could not run.
- Hack findings must link to exact commands and evidence.
- Studio outputs must link to model, prompt, settings and source Run.

## 3.3 State consistency

- Pricing, usage limits, model catalogs, plugin states and agent policies must come from one canonical data source.
- Route, selected navigation item and rendered surface must always agree.
- Route changes must close transient overlays.
- No modal or context menu may survive into an unrelated page.
- A status shown in two components must use the same state enum and timestamp.

## 3.4 Accessibility

- WCAG 2.2 AA contrast for text and interactive controls.
- Minimum 14 px for ordinary secondary text; 12 px only for compact metadata when contrast is high.
- Full keyboard access and visible focus rings.
- Correct focus trapping and return-focus behavior in dialogs.
- Reduced-motion support.
- Screen-reader announcements for Run state changes, errors and approvals.
- Do not encode severity or state through color alone.

---

# 4. Information architecture

## 4.1 Primary navigation

Replace the fragmented navigation with the following stable hierarchy:

### Work

- Home
- Projects
- Runs
- Tasks

### Create and operate

- Build
- Studio
- Hack
- Workspace

### Configure

- Agents
- Teams
- Skills
- Plugins

### Library

- Artifacts
- Reports

### System

- Usage
- Settings

The left sidebar should remain compact. Do not place every destination at the same visual priority.

## 4.2 Projects

A Project is the top-level context container and owns:

- Name, icon and description
- Project type: Software, Media, Security or Mixed
- Repository/folder
- Default workspace and environment
- Default agent or team
- Default model and reasoning
- Permission profile
- Skills and plugins
- Memory and notes scope
- Budget and usage limits
- Runs, tasks, artifacts and reports
- Members and roles when collaboration is available

Project creation must support Software, Media, Security and Mixed. Do not expose only Build and Image while Studio supports video and Hack exists.

## 4.3 Runs

Runs must be a first-class destination with filters:

- Running
- Needs attention
- Completed
- Failed
- Cancelled
- Scheduled

Each Run card shows:

- Project
- Goal
- Surface: Build, Studio, Hack or Task
- Agent/team
- Model
- Current phase
- Started time and duration
- Cost
- Verification status
- Output count
- Failure/cancellation reason when applicable

---

# 5. Application shell redesign

## 5.1 Desktop layout

Use a stable three-zone system:

- **Navigation:** 232–256 px, collapsible to 64 px.
- **Primary canvas:** flexible, minimum 640 px.
- **Inspector:** 360–440 px, resizable, collapsible.

The inspector contains context-sensitive tabs:

- Activity
- Changes
- Preview
- Terminal
- Evidence
- Artifacts
- Cost

The active Run remains visible in a compact top status bar across Build, Workspace, Studio and Hack.

## 5.2 Responsive behavior

### ≥1440 px

- Three zones may remain visible.
- Inspector defaults open during an active Run.

### 1024–1439 px

- Navigation can collapse.
- Inspector becomes an overlay drawer or 35% split.

### 768–1023 px

- Navigation is a drawer.
- Primary canvas remains full width.
- Inspector opens as a right sheet.

### <768 px

- Bottom navigation: Home, Projects, Run, Library, More.
- Composer remains fixed above safe area.
- Activity, Changes, Preview and Terminal become full-screen subviews.
- Tables become stacked cards.
- Do not shrink desktop three-column UI into mobile.

## 5.3 Global command palette

The command palette must include:

- Go to project
- Go to run
- Go to file
- Go to symbol
- Open terminal
- Toggle preview
- Toggle inspector
- Create agent/team/task
- Run tests/build/review
- Change model/reasoning
- Change permission mode
- Search chats, artifacts and commands

Resolve conflicting keyboard shortcuts. One command must not have two meanings in the same scope.

---

# 6. Design system

## 6.1 Brand direction

Keep RIFT dark, technical and cinematic, but reduce decorative HUD noise in productivity surfaces.

- Build and Workspace: calm, precise, tool-like.
- Studio: visual and expressive.
- Hack: operational HUD, but readable and evidence-first.
- Settings and configuration: neutral and dense without becoming cramped.

Pet characters may communicate personality and background activity, but must not replace professional status icons, agent names or state labels.

## 6.2 Color tokens

Do not hardcode colors inside page components. Use semantic tokens:

```css
--bg-canvas
--bg-sidebar
--bg-surface-1
--bg-surface-2
--bg-elevated
--border-subtle
--border-default
--border-strong
--text-primary
--text-secondary
--text-tertiary
--accent-primary
--accent-hover
--status-info
--status-success
--status-warning
--status-danger
--status-neutral
--focus-ring
--selection
```

Requirements:

- Avoid large black-on-black regions with no hierarchy.
- Use surfaces and borders together; do not rely only on 1 px hairlines.
- Increase secondary text contrast.
- Use one accent color per surface, not several competing neon colors.
- Severity colors must also include icon and text labels.

## 6.3 Typography

Recommended hierarchy:

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| Display | 48–64 | 550–650 | 1.05 |
| Page title | 28–32 | 600 | 1.2 |
| Section title | 18–20 | 600 | 1.3 |
| Card title | 15–16 | 550–600 | 1.35 |
| Body | 14–16 | 400–450 | 1.5 |
| Secondary | 13–14 | 400 | 1.45 |
| Metadata | 12 | 450–500 | 1.35 |
| Code/terminal | 12.5–14 | 400–500 | 1.5 |

- Use a UI sans font for navigation and body.
- Use a monospace font only for code, command output, IDs and technical measurements.
- Do not display ordinary labels in monospace merely to appear technical.
- Avoid uppercase text for paragraphs or long labels.

## 6.4 Spacing and sizing

Use a 4 px base grid with primary steps:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64`

- Standard control height: 36 or 40 px.
- Primary composer controls: 40 px minimum.
- Touch targets: 44 px minimum on mobile.
- Standard card padding: 16–20 px.
- Modal content width: 480–640 px for simple tasks only.
- Configuration workflows longer than two sections must use a full page or stepper, not a tall modal.

## 6.5 Radius, shadow and borders

- Small controls: 6–8 px radius.
- Cards: 10–12 px.
- Large panels: 12–16 px.
- Avoid excessive pill-shaped containers.
- Use shadows only for true elevation: dialogs, menus and floating inspectors.
- Use borders and background contrast for fixed panels.

## 6.6 Motion

- Micro-interactions: 120–180 ms.
- Panel transitions: 180–240 ms.
- Page transitions: subtle opacity/translate, maximum 240 ms.
- Do not animate terminal lines or progress merely for decoration.
- Status changes should animate once and settle.
- Use skeletons for structured loading, not generic full-page “Loading extensions…” messages.
- Respect `prefers-reduced-motion`.

---

# 7. Global component requirements

## 7.1 Status component

Canonical statuses:

- Draft
- Queued
- Starting
- Running
- Waiting for approval
- Stopping
- Cancelled
- Failed
- Completed
- Completed with warnings
- Degraded
- Disconnected

Each status component must accept:

- Label
- Semantic color
- Icon
- Timestamp
- Optional reason
- Optional progress

## 7.2 Empty states

Every empty state must answer:

1. What is this area?
2. Why is it empty?
3. What should the user do next?
4. Is there an example or template?

Do not leave a large blank canvas with only a composer.

## 7.3 Loading states

- Preserve layout while loading.
- Use page-specific skeletons.
- After 2 seconds, show a concise progress message.
- After 8 seconds, show troubleshooting/retry options.
- Never show stale success data under a loading overlay.

## 7.4 Error states

Every error must contain:

- What failed
- What was preserved
- Whether retry is safe
- Retry action
- Copy diagnostics
- Open logs where appropriate

## 7.5 Dialog policy

Use a dialog only when:

- The task is short.
- The user does not need to compare other page information.
- The content fits without internal scrolling at common laptop height.

Use a full page or side inspector for agent creation, team creation and complex permission configuration.

## 7.6 Tooltips and discoverability

- Icon-only buttons require accessible labels and tooltips.
- Reasoning must open a clear menu, not cycle silently on click.
- Model cards must explain speed, quality, cost and recommended use.
- Permission modes must show practical examples.

---

# 8. Home and Build redesign

## 8.1 Home

Create a useful authenticated home page containing:

- Continue working
- Active Runs
- Needs attention
- Recent Projects
- Scheduled tasks
- Usage and budget snapshot
- Quick actions
- Templates

Quick actions:

- Open repository
- Create project
- Start a Build
- Generate media
- Start authorized security assessment
- Create task

## 8.2 Build composer

The composer must contain:

- Project/workspace context
- Mode: Ask, Plan, Build
- Agent or Team
- Model
- Reasoning
- Permission profile
- Context attachments
- Estimated cost range before starting when possible

Use a single compact control row. Advanced controls open in a popover.

## 8.3 Model picker

Each model row shows:

- Model name and provider
- Recommended task
- Speed
- Quality/reasoning
- Context
- Tool support
- Estimated credit multiplier
- Availability

Descriptions must not be clipped. Add search and filters.

## 8.4 Slash and context menus

- Opening Search or changing route closes `/` and `@` menus.
- `@` results are grouped and searchable.
- Recent and relevant items appear first.
- Each context item explains what access it gives.
- Keyboard navigation must remain within the active menu.

## 8.5 Active Build Run

The center canvas should show structured phases:

1. Understanding
2. Exploring
3. Planning
4. Implementing
5. Verifying
6. Ready for review

Each phase may expand to reveal tool calls and reasoning summaries. Do not expose hidden chain-of-thought. Show concise, user-facing rationale and evidence.

The inspector should default to:

- Activity while exploring
- Changes while implementing
- Preview/tests while verifying
- Receipt when completed

---

# 9. Workspace redesign

## 9.1 Required panels

- Explorer
- Search
- Source control
- Problems
- Terminal
- Tests
- Ports
- Preview/browser
- Agent

## 9.2 Git workflow

If no repository is detected, show:

- Initialize Git
- Clone repository
- Open another folder
- Continue without Git

Source control must support:

- Changed file list
- Stage/unstage
- File diff
- Hunk accept/reject
- Branch display
- Commit message
- Commit/push/PR actions
- Conflict display

## 9.3 Agent change review

- Show agent edits as they occur.
- Link every edit to the responsible Run step.
- Allow file and hunk-level accept/reject.
- Provide “Accept all verified changes”.
- Provide checkpoint restoration.
- Warn if files changed outside RIFT after the proposal was created.

## 9.4 Preview and browser

- Detect running dev servers and ports.
- Open preview automatically after a successful start command.
- Include viewport presets.
- Capture screenshots.
- Display console and network errors.
- Let the agent inspect the preview with explicit browser permissions.
- Link visual verification evidence to the Run.

## 9.5 Terminal

- Preserve terminal sessions across panel changes.
- Clearly distinguish local, sandbox and remote terminals.
- Do not show a reconnection warning on a fresh session.
- Show command ownership: User, Agent or Task.
- Link agent commands to their Run steps.

---

# 10. Agents redesign

## 10.1 Agents overview

Split into:

- Built-in agents
- Custom agents
- Teams
- Run performance

Agent cards show:

- Name and role
- Status
- Current Run
- Default model
- Effective permission level
- Skills
- Success rate after enough data exists
- Average cost and duration

Do not show meaningless metrics when data is insufficient. Say how many attributable Runs are required.

## 10.2 Agent creation flow

Use a five-step full-page flow:

1. Identity and mission
2. Runtime and autonomy
3. Access and permissions
4. Skills and tools
5. Review and test

The final review must show:

- Enforced settings
- Advisory guidance
- Effective tool access
- Filesystem boundary
- Network boundary
- Concurrency
- Model and cost implications
- Escalation behavior

Add a sandboxed test prompt before saving.

## 10.3 Agent duplication and versioning

- Agent edits create versions.
- Existing Runs retain the agent version used.
- Duplicate clearly creates a new independent agent.
- Deletion explains what happens to historical Runs.

---

# 11. Teams redesign

## 11.1 Team editor

Use a full-page editor with tabs:

- Overview
- Members
- Routing
- Handoffs
- Review policy
- Permissions
- Completion contract
- Test scenario

## 11.2 Live team execution

During a Run show:

- Lead
- Active agents
- Assigned subtasks
- Queued subtasks
- Handoffs
- Reviewer decisions
- Evidence returned by each agent
- Token/credit use per agent

Allow the user to inspect an agent thread without leaving the parent Run.

## 11.3 Completion contract

Completion criteria must be machine-checkable where possible:

- Tests pass
- Build succeeds
- No high-severity findings
- Required artifact exists
- Reviewer approved
- Budget not exceeded

The Run must show which criteria passed, failed or could not be evaluated.

---

# 12. Tasks redesign

Task creation must include:

- Name
- Project
- Goal
- Surface/mode
- Agent or team
- Workspace/repository
- Model and reasoning
- Permission profile
- Schedule or event trigger
- Timezone
- Maximum duration
- Retry policy
- Credit budget
- Failure notification
- Output destination
- Completion criteria

Supported schedules:

- Manual
- One-time
- Recurring
- GitHub event
- API/webhook where supported

Remove selectors that contain only one option. If only Build is available, show it as fixed information rather than a combobox.

Task history must show each Run and make logs, outputs and costs accessible.

---

# 13. Plugins redesign

## 13.1 Connection state

Use one canonical state:

- Not connected
- Connecting
- Connected
- Connected with warnings
- Needs reauthorization
- Disabled
- Error

Do not display `Connected` in one card and `Needs attention` elsewhere.

## 13.2 Plugin details

Each plugin must have a detail view containing:

- Provider and source
- Authentication method
- Requested scopes
- Read/write capabilities
- Available tools
- Last verified
- Last used
- Recent errors
- Activity history
- Projects and agents allowed to use it
- Reconnect and disconnect

Before connection, show the scopes and examples of actions the agent could perform.

## 13.3 Custom MCP

Custom MCP setup requires:

- Name
- URL/transport
- Authentication
- Tool discovery preview
- Permission defaults
- Health test
- Save disabled until validation passes or the user explicitly chooses to save unverified

---

# 14. Skills redesign

Each skill must show:

- Source: built-in, user or plugin
- Version
- Triggering method
- Applicable surfaces
- Required tools
- Permission requirements
- Last used
- Enabled state

Skill configuration must include:

- Auto-route or fixed invocation
- Trigger description
- Priority
- Conflicts
- Test prompt
- Version history

Built-in skills may be disabled but must not use the same destructive delete icon as user-created skills.

During a Run, show which skill was selected and a concise explanation of why.

---

# 15. Artifacts and Reports redesign

## 15.1 Artifact card metadata

- Title
- Type
- Thumbnail/poster frame
- Project
- Source Run
- Model
- Created time
- Size/duration/aspect ratio
- Cost

## 15.2 Artifact actions

- Open
- Rename
- Download
- Share
- Delete
- Open source Run
- Copy prompt/settings
- Remix
- Compare variants

## 15.3 Reports

Separate reports from generic media artifacts.

Reports include:

- Build receipt
- Code review
- Security assessment
- Scheduled task summary
- Usage report

Reports must be exportable as Markdown/PDF/JSON where appropriate.

---

# 16. Studio redesign

## 16.1 Model catalog consistency

- Composer and model library must use the same API.
- Model count must be derived, never hardcoded.
- Availability, capabilities and credit cost come from one model registry.

## 16.2 Structured generation controls

Image controls:

- Aspect ratio
- Resolution
- Output count
- Seed
- Reference images
- Reference strength
- Negative prompt where supported
- Guidance/style strength where supported

Video controls:

- Duration
- Resolution
- Frame rate
- Aspect ratio
- Audio
- Start/end frame
- Camera/motion controls
- Seed where supported

Unsupported controls must be hidden or clearly disabled for the selected model.

## 16.3 Prompt patterns

Convert raw placeholders such as `[product]` into structured fields. Show the generated final prompt in an optional advanced editor.

## 16.4 Generation Run

Show:

- Queue state
- Estimated duration
- Estimated credit cost
- Model and settings
- Progress
- Variants
- Failure and retry
- Source references

Every generated asset must preserve its exact lineage.

---

# 17. Hack Workbench redesign

## 17.1 Scope and authorization

Before starting an active assessment show:

- Target
- Authorization confirmation
- In-scope hosts/ranges
- Exclusions
- Assessment profile
- Permission boundary
- Estimated intensity and duration

Do not repeatedly interrupt authorized work when the saved scope and policy already cover the action, but require approval for scope expansion or sensitive external actions.

## 17.2 Run phases

Canonical phases:

1. Scope validation
2. Discovery
3. Enumeration
4. Validation
5. Risk analysis
6. Reporting

Each phase shows:

- Status
- Active tool
- Reason for tool selection
- Started time
- Duration
- Evidence count
- Errors/retries

## 17.3 Stop behavior

When Stop is pressed:

1. Button immediately changes to `Stopping…`.
2. Duplicate stop controls are disabled.
3. UI announces that cancellation was requested.
4. The current process receives the configured termination signal.
5. After grace period, force termination is attempted when safe.
6. Final state becomes Cancelled, Failed to stop or Completed.
7. All evidence captured before cancellation remains accessible.

## 17.4 Evidence model

Evidence items require:

- Evidence ID
- Timestamp
- Source tool/command
- Target
- Raw output reference
- Normalized summary
- Hash where appropriate
- Related finding
- Confidence

Findings must link back to evidence. Never show Verified without a supporting evidence link.

## 17.5 Reports

Security report sections:

- Executive summary
- Scope and limitations
- Timeline
- Attack surface
- Findings by severity
- Evidence
- Reproduction steps
- Remediation
- Unverified hypotheses
- Tool errors and coverage gaps

Allow export to Markdown, PDF, JSON and SARIF when applicable.

## 17.6 Readability

- Increase body and metric label sizes.
- Reserve monospace for technical values.
- Reduce decorative grid/noise behind text.
- Keep important controls visible at common 13–14 inch laptop heights.
- Use one Stop control in the persistent Run bar and an optional mirrored control only when synchronized.

---

# 18. Settings redesign

Use one settings navigation system. Do not stack a full application sidebar and an equally heavy settings sidebar without responsive behavior.

## 18.1 General and memory

Memory/notes require:

- Search
- Project/global scope
- Category
- Source chat or Run
- Created/updated time
- Last used
- Edit
- Remove
- Export
- Sensitivity label
- Explanation of where the memory may be used

Do not place all sensitive saved notes inside one giant unfiltered modal.

## 18.2 Appearance

- RIFT Light
- RIFT Dark
- RIFT OLED
- System

Additional community-inspired themes may remain secondary. Add preview, reset and undo after applying a theme.

## 18.3 Workbench and terminal

Clearly explain:

- Local vs sandbox vs cloud
- Filesystem access
- Network access
- Browser access
- Local folder grants
- Persistence and retention

## 18.4 Agents and permissions

Use the same agent/policy objects as the Agents page. Settings may define defaults and organization-level guardrails, but must not create a second editable copy of the same agent.

Show effective policy and inheritance:

`Organization → User → Project → Agent/Team → Run override`

## 18.5 API keys

Add:

- Name
- Scopes
- Expiration
- Last used
- Created time
- Partial prefix
- Per-key budget/rate limit
- Revoke and rotate
- Audit history

Replace pipe-to-runtime installation instructions with a signed package, verified package manager installation or checksum-based installer.

## 18.6 Privacy and security

Add:

- Data export
- Retention controls
- Training/data-use setting where applicable
- Active sessions and devices
- 2FA/SSO
- Connected applications
- Audit log
- Project deletion
- Account deletion
- Data residency explanation where applicable

## 18.7 Usage and billing

Use `credits` consistently. Do not call credits tokens in helper copy.

Show:

- Current balance
- Included vs top-up credits
- Daily/monthly usage
- Cost per Run
- Cost by model/tool/project
- Forecast
- Budget alerts
- Invoices and receipts
- Extra usage setting

Make every `View details` control navigate or open a real destination.

## 18.8 Account and organization

Separate Account and Organization.

Account:

- Profile
- Email/auth providers
- Password where applicable
- Sessions/devices
- Delete account

Organization:

- Members
- Invitations
- Roles
- Groups
- SSO
- Billing roles
- Audit log

---

# 19. Pricing, landing and download

## 19.1 Pricing

- Public pricing and application limits must use the same plan configuration.
- Show what one credit represents with example Runs.
- Add a cost calculator or examples for Ask, Build, Studio and Hack.
- Clearly distinguish included credits, top-ups and expiration.
- Use one vocabulary across all surfaces.

## 19.2 Landing

Replace excessive empty space with proof-oriented sections:

- Interactive Run Receipt
- Build workflow
- Studio output lineage
- Hack evidence chain
- Agent team orchestration
- Security and permissions
- Customer proof/examples
- Pricing

The landing page must visually demonstrate the product, not only describe it.

For authenticated users, replace Login/Start building with Open RIFT and account access.

## 19.3 Download

- Display platform support clearly.
- Signed and notarized desktop releases are required before positioning desktop as production-ready.
- Show version, release date, changelog, checksum and system requirements.
- Explain browser fallback without making it feel inferior.
- Detect unsupported platforms without presenting misleading download actions.

---

# 20. Canonical data and event model

The exact implementation may adapt to the existing backend, but the UI requires equivalent entities.

## 20.1 Core entities

```ts
type Project = {
  id: string
  name: string
  type: 'software' | 'media' | 'security' | 'mixed'
  workspaceId?: string
  repository?: RepositoryRef
  defaultExecutor?: ExecutorRef
  policyProfileId: string
  budget?: BudgetPolicy
}

type Run = {
  id: string
  projectId: string
  surface: 'build' | 'studio' | 'hack' | 'task'
  goal: string
  status: RunStatus
  phase: string
  executor: ExecutorRef
  model: ModelRef
  policySnapshot: PolicySnapshot
  startedAt?: string
  completedAt?: string
  cost: CostSummary
  completionCriteria: CompletionCriterion[]
}

type RunEvent = {
  id: string
  runId: string
  sequence: number
  timestamp: string
  type: string
  actor: ActorRef
  status?: string
  summary: string
  payloadRef?: string
}

type Evidence = {
  id: string
  runId: string
  eventId: string
  kind: 'command' | 'test' | 'screenshot' | 'network' | 'file' | 'finding' | 'generation'
  createdAt: string
  source: string
  rawRef?: string
  normalizedSummary?: string
  hash?: string
}

type Artifact = {
  id: string
  projectId: string
  runId: string
  type: string
  title: string
  model?: ModelRef
  settings?: Record<string, unknown>
  createdAt: string
}
```

## 20.2 Event requirements

- Events must be ordered by server-assigned sequence.
- Reconnection fetches missing events and resumes streaming.
- The client must not infer completion from the absence of new events.
- Duplicate events must be idempotently ignored.
- Run status is server authoritative.
- Cancellation requests receive an acknowledgement ID.

---

# 21. Security and permission UX

Use permission profiles:

- Read only
- Workspace write
- Sandboxed autonomous
- Trusted
- Custom

Before a Run show a compact summary:

- Files: read/write boundary
- Network: none/allowlist/public
- Terminal: sandbox/local/cloud
- Browser: disabled/manual/allowlisted/automatic
- External writes: ask/allowed/blocked
- Destructive actions: ask/blocked

During approval show:

- Exact action
- Reason
- Target
- Risk
- Scope of approval: once, this Run, this Project or policy change

Never let an advisory setting look like an enforced security boundary.

---

# 22. Analytics and product telemetry

Track privacy-respecting events for:

- Project creation completion/drop-off
- First successful Run
- Run failure phase
- Stop request latency
- Run recovery after refresh
- Diff acceptance/rejection
- Preview opened
- Verification completed
- Plugin connection failure
- Task completion/failure
- Studio generation retry
- Hack report export
- Empty-state CTA usage

Key metrics:

- Time to first successful verified Run
- Percentage of Runs with evidence
- Percentage of Builds reviewed before completion
- Cancellation acknowledgement latency
- Recovery success rate
- Task success rate
- Cost estimation error
- Plugin reconnect success
- Project retention

Do not log secrets, terminal payloads or sensitive saved notes to analytics.

---

# 23. Implementation priority

## Phase 0 — Repository audit and baselines

- Map routes, components, stores and backend services.
- Identify duplicate sources for plans, models, agents and plugin states.
- Capture screenshots of every major page at desktop and mobile widths.
- Add or stabilize smoke tests before large refactors.
- Document current schemas and migration risk.

## Phase 1 — P0 reliability

- Persisted Run and RunEvent model.
- Reconnection and refresh recovery.
- Correct stop state machine.
- Evidence persistence.
- Overlay and route-state cleanup.
- Canonical status enums.
- Fix pricing/model/plugin inconsistencies.
- Remove broken/dead controls.

## Phase 2 — Core coding loop

- Project/repository onboarding.
- Workspace source control and diff review.
- File/hunk accept/reject.
- Checkpoints and restore.
- Tests/problems/ports/preview.
- Run Receipt.

## Phase 3 — Agent and automation UX

- Full-page agent editor.
- Full-page team editor.
- Live delegation topology.
- Project-scoped tasks.
- Effective policy inspector.

## Phase 4 — Studio, Hack and Library depth

- Studio structured controls and lineage.
- Hack evidence chain and report exports.
- Artifact metadata and source linking.
- Reports destination.

## Phase 5 — Settings, collaboration and polish

- Memory scope and privacy controls.
- Usage/cost explorer.
- Organization/member features.
- Responsive/mobile refinement.
- Accessibility audit.
- Signed desktop distribution.

Do not begin Phase 4 cosmetic expansion while Phase 1 trust failures remain.

---

# 24. Acceptance criteria

## 24.1 Global

- Navigating between any two routes closes unrelated overlays.
- Back/forward navigation renders the correct active page and sidebar state.
- No important button is visually enabled without an implemented action.
- All pages have designed loading, empty, error and success states.
- Keyboard-only navigation can reach all actions.
- Common text and controls meet WCAG AA contrast.
- Layout works at 1440, 1280, 1024, 768, 390 and 360 px widths.

## 24.2 Run reliability

- Refreshing during a Run restores the same Run and event history.
- Navigating away and returning preserves status, progress and evidence.
- Stop acknowledgement appears in under one second under normal connectivity.
- Cancelled Runs preserve partial evidence and outputs.
- Disconnected streaming does not incorrectly mark a Run complete.

## 24.3 Workspace

- A user can initialize/open a Git repository from the empty state.
- Agent changes appear in a diff.
- A user can accept or reject one hunk.
- A user can restore a checkpoint.
- Tests and preview evidence are linked to the Run Receipt.

## 24.4 Agents and teams

- Effective permissions are visible before save and before Run.
- A test Run can validate an agent configuration.
- Team delegation and reviewer decisions are visible in the parent Run.
- Historical Runs retain the exact agent/team version used.

## 24.5 Studio

- Model count matches between library and composer.
- Unsupported controls change with model selection.
- Every output retains prompt, model, settings, cost and source Run.

## 24.6 Hack

- Findings link to evidence.
- Evidence links to the source command/tool.
- Cancelled scans remain reopenable.
- Reports describe coverage gaps and unverified hypotheses.
- Multiple stop controls cannot disagree.

## 24.7 Pricing and usage

- Public and in-app plan limits match exactly.
- Every completed Run has a cost breakdown.
- Usage details controls open a working view.

---

# 25. Required automated tests

## End-to-end

- Login and authenticated redirect.
- Create/open Project.
- Start Build Run, navigate away, return and verify persistence.
- Stop a Run and verify state/evidence.
- Open `@` menu, navigate to Studio and verify overlay closes.
- Start Run, refresh, verify event recovery.
- Accept/reject diff hunk.
- Restore checkpoint.
- Create scheduled task tied to a Project.
- Plugin reconnect and degraded state.
- Studio generation lineage.
- Hack finding-to-evidence navigation.
- Mobile navigation and composer.

## Component/state tests

- Run state machine.
- Canonical status badge.
- Model registry rendering.
- Pricing plan rendering.
- Plugin connection-state mapping.
- Overlay manager.
- Permission inheritance summary.
- Run cost calculation presentation.

## Accessibility

- Automated axe checks for all primary routes.
- Keyboard dialog/menu tests.
- Focus restoration tests.
- Reduced-motion snapshot tests.

---

# 26. Definition of done

A page is not done because it visually matches a mockup. It is done when:

- Real data is connected.
- Loading, empty, error, partial and success states exist.
- Keyboard and screen-reader behavior is correct.
- Responsive behavior is verified.
- Analytics events are defined without sensitive payloads.
- Automated tests pass.
- No stale or duplicate source of truth remains.
- The flow has been tested in the browser from the user's perspective.
- Before/after screenshots and a concise change log are produced.

---

# 27. MASTER IMPLEMENTATION PROMPT — copy and paste into Codex or Claude Code

```text
You are working on the production RIFT application. Your task is to perform a systematic UI/UX, product-logic and agent-experience overhaul using the attached `RIFT_UI_UX_MASTER_REDESIGN_AND_IMPLEMENTATION.md` as the authoritative product specification.

Do not treat this as a visual reskin. The goal is to make RIFT trustworthy, reviewable, reversible, consistent and competitive with the strongest coding-agent products while preserving RIFT's unique Build, Studio, Hack, Agents and Teams identity.

MANDATORY FIRST STEP

Before editing code:

1. Inspect the entire repository structure, package scripts, routes, layouts, design system, shared components, state stores, API clients, database schema, migrations and tests.
2. Run the existing application and inspect every major route in a real browser at desktop and mobile widths.
3. Capture the current behavior and identify which specification items already exist, partially exist or are missing.
4. Locate duplicate sources of truth for pricing plans, usage limits, model catalogs, plugin connection states, agent configuration and Run state.
5. Produce a short implementation map grouped into Phase 1, Phase 2 and later work. Then immediately begin Phase 1 unless a real blocker requires user input.

CORE PRODUCT MODEL

Implement and consistently reflect this object model throughout the product:

Project → Run → Agent/Team Execution → Events/Evidence/Changes/Artifacts → Review → Accept/Roll back/Export.

Chat is not the primary object. It is context attached to a Project or Run.

P0 — COMPLETE THESE FIRST

1. Create or normalize a server-authoritative Run state machine with queued, starting, running, waiting_for_approval, stopping, cancelled, failed, completed and completed_with_warnings states.
2. Persist ordered Run events so active and completed Runs survive navigation, refresh, reconnect and session restoration.
3. Make Stop acknowledge immediately, transition to Stopping, terminate safely and preserve all partial evidence and outputs.
4. Fix route/state mismatches and ensure all transient composer, slash, context and search overlays close on unrelated navigation.
5. Replace duplicate/hardcoded plan limits, model catalogs and plugin states with canonical registries or services.
6. Fix every observed inconsistency, including public vs in-app Free limits, Studio model count vs composer models, contradictory plugin connection states and duplicated agent settings.
7. Remove or disable controls that currently do nothing. Never leave a visually enabled dead action.
8. Create a reusable Run Receipt showing goal, executor, model, permissions, timeline, tool actions, changes, evidence, verification, cost and final status.

CORE CODING EXPERIENCE

1. Upgrade Workspace from an IDE-looking shell into a complete agent review surface.
2. Add Git onboarding for folders without a repository.
3. Add changed files, file diff, hunk-level accept/reject, stage/unstage, checkpoint and restore flows.
4. Add Problems, Tests, Ports and Preview/Browser panels.
5. Detect development servers and connect preview, console, network and screenshot evidence to the active Run.
6. Link every agent edit and terminal command to the Run event that produced it.

UI/UX SYSTEM

1. Preserve RIFT's dark, cinematic identity, but reduce black-on-black ambiguity, tiny low-contrast text and unnecessary HUD decoration in productivity screens.
2. Build semantic design tokens for canvas, surfaces, borders, text, accent, focus and statuses. Remove page-level hardcoded colors where practical.
3. Use a consistent typography hierarchy. Ordinary secondary text must be at least 13–14 px and readable; reserve 12 px for high-contrast metadata.
4. Use a 4 px spacing system, 36–40 px desktop controls and 44 px mobile touch targets.
5. Implement a responsive app shell: collapsible 232–256 px navigation, flexible primary canvas and 360–440 px resizable inspector. On mobile, use purpose-built full-screen subviews and bottom navigation rather than shrinking the desktop layout.
6. Use dialogs only for short tasks. Convert Agent creation, Team creation and other long configuration flows into full-page editors or steppers.
7. Add designed loading, empty, error, partial-success and success states to every route.
8. Resolve all keyboard shortcut collisions and implement predictable focus management, Escape behavior and accessible labels.
9. Meet WCAG 2.2 AA and support reduced motion.

PAGE REQUIREMENTS

- Home: active Runs, needs-attention work, recent Projects, tasks, usage and strong quick actions.
- Build: Ask/Plan/Build modes, clear model/reasoning/permission controls, useful empty state and structured execution phases.
- Workspace: real diff review, Git, tests, problems, terminal, ports and preview.
- Agents: full-page five-step editor, effective permissions summary, versioning and sandboxed test Run.
- Teams: full-page orchestration editor and live delegation/handoff/reviewer topology.
- Tasks: Project, executor, workspace, model, permissions, timeout, retry, budget, notifications and output destination.
- Plugins: canonical health states, scope preview, tool list, last used, activity and reconnect diagnostics.
- Skills: source/version/triggers/priority/conflicts/test flow and clear built-in vs user deletion behavior.
- Artifacts: metadata, thumbnails/poster frames, source Run, prompt/settings lineage, rename/share/delete/remix/compare.
- Studio: canonical model registry, structured image/video controls, cost/time estimate, variants and complete output lineage.
- Hack: persistent evidence-first phases, reliable Stop, command exit codes, finding-to-evidence links, coverage gaps and exportable reports.
- Settings: one navigation system, scoped/searchable memories, policy inheritance, scoped API keys, privacy/session controls, cost explorer and separate Account/Organization areas.
- Pricing/Download/Landing: canonical plan data, authenticated header state, proof-oriented product demos and signed/notarized release information.

AGENT EXPERIENCE

Do not expose hidden chain-of-thought. Show concise user-facing reasoning summaries, plans, current phase, tool intent, evidence and completion criteria.

At Run start show the effective agent/team, model, reasoning, permissions, filesystem/network/browser scope and estimated cost. During a Team Run show assignments, handoffs, reviewer decisions and per-agent evidence. At completion show which completion criteria passed, failed or were not evaluated.

SECURITY

Clearly distinguish enforced controls from advisory instructions. Use permission inheritance from organization/user/project/agent/run. Approval prompts must state the exact action, target, risk and scope of approval. Do not weaken existing security boundaries. Replace unsafe pipe-to-runtime installation guidance with a verifiable package or signed/checksummed installer.

ENGINEERING RULES

- Reuse the existing stack and architecture unless a change is technically necessary and justified.
- Preserve unrelated user changes and do not perform destructive repository operations.
- Prefer shared components and canonical types over page-specific copies.
- Add schema migrations safely and provide backward compatibility where necessary.
- Use server-authoritative status and ordered idempotent events.
- Do not infer completion because streaming stopped.
- Do not fabricate backend data to make the UI look complete.
- Do not copy another product's exact trade dress. Match the usability and workflow quality while keeping RIFT recognizably RIFT.
- Do not stop after static mockups. Connect real behavior and data.

VALIDATION

After each phase:

1. Run formatting, type checking, linting, unit tests and production build.
2. Run end-to-end browser tests for the changed flows.
3. Verify desktop widths 1440, 1280 and 1024, tablet 768, and mobile 390 and 360.
4. Verify keyboard-only navigation, focus behavior, reduced motion and automated accessibility checks.
5. Test loading, empty, error, disconnected, cancelled and partial-success states.
6. Capture before/after screenshots for every changed major route.
7. Report exactly what was implemented, what remains, any migrations, known risks and the next highest-priority work.

Do not claim completion until the implemented flows work end-to-end with real state, persistence, review and recovery. Begin with the repository audit and Phase 1 P0 reliability work now.
```

---

# 28. Short prompt for continuing after context loss

```text
Continue the RIFT overhaul from `RIFT_UI_UX_MASTER_REDESIGN_AND_IMPLEMENTATION.md`. Inspect the repository and current git diff first, preserve existing work, identify the first incomplete item in the ordered implementation phases, implement it end-to-end, run relevant validation and update the progress record. Do not skip persistence, error states, responsive behavior, accessibility or browser verification. Do not declare completion based only on visual appearance.
```

---

# 29. Final strategic rule

Do not add more models, pets, skills or Hack tasks until RIFT can reliably prove, preserve, review and reverse the work it already performs.

