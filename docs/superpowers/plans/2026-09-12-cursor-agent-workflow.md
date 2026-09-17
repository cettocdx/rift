# Cursor Agents workflow implementation plan

**Goal:** Match the observed agent-first workflow: compact live collaborators by
the composer and genuine non-interrupting follow-ups in a running RIFT task.
**Architecture:** Preserve current task identity, worker ownership, durable
transcript, and existing activity navigation. Add presentation over actual
delegation receipts, then an authorized durable instruction inbox consumed only
at a safe model-step boundary. Never rename a cancel/restart path to steering.
**Tech stack:** React, TypeScript, Next.js, Convex, AI SDK, Trigger worker.

The user explicitly authorized this design direction, continuous implementation
and agent review without approval pauses. This plan covers one workflow inside
the full desktop/web/mobile goal; it does not redefine whole-goal completion.

## Reference / design

Observed the running Cursor Agents window in /Volumes/Cursor Installer/Cursor.app,
not IDE: Working list above composer, short task labels, combined model control,
Steer without interrupting entry. Existing user work was not stopped or changed.

Choose a bounded inline collaborator tray over an always-open activity sidebar
or a second global task dashboard. It keeps the message entry location useful
while details remain in the existing workspace panel. Cap expanded height;
truncate visual long labels while preserving accessible text. Use RIFT's theme
and type tokens, restrained borders, 44px coarse-pointer targets, keyboard
operation, reduced-motion support; do not add another permanent status bar.

## Task 1 — Collaborator tray

Files: app/components/ChatInput/AgentWorkingTray.tsx (new), adjacent CSS module
and tests; app/components/ChatInput/ChatInput.tsx; app/components/chat.tsx.
Consumes current-run delegation data from extractSubagentsFromMessages using
full message indices with currentRunOnly:true, actual ChatStatus, and existing
agent-activity navigation event. Receipts are authoritative; completed tasks
never count as working. Queued, running, awaiting-approval are distinguishable.

- [x] Add regression tests: no row without delegates; correct mixed-status count;
      no stale active state after terminal parent; selection opens exact invocation;
      collapse/expand keyboard; completion retains readable result status.
- [x] Run focused tests RED before implementation.
- [x] Implement memoized compact tray, default expanded for collaborators,
      bounded scrolling, no auto-focus/scroll on arrivals, no fabricated individual
      cancellation. Integrate one optional composer accessory slot so ChatInput
      does not subscribe to the whole streaming history or keystroke state.
- [x] Verify callback/event opens activity details on desktop and mobile.
- [x] Run focused tests GREEN, lint and typecheck. Root adds actual-browser
      narrow/wide geometry and focus tests before final commit gate.

## Task 2 — Non-interrupting instructions

- [x] Audit actual queue, approval, worker checkpoint and ownership paths.
- [x] Write concrete schema/API/claim-ack design with restart semantics before
      implementation; owner+chat+run scopes and idempotency are mandatory.
- [ ] Add denial, duplicate, late completion, cancellation, crash/retry and
      ordered-consumption tests before wiring production worker.
- [ ] Accept instructions durably; display pending/applied honestly. Preserve
      queued-next-task and explicit stop-and-send as distinct choices.
- [ ] Consume at model-step boundary without replaying completed side effects;
      pending approval must not silently approve or mutate a tool call.
- [ ] Verify real long task, route change/reconnect and follow-up outcomes.

## Release gates

- [ ] Independent source review; normal commit hook (lint, CLI integrity, full
      typecheck/Jest) and production build.
- [ ] Update Preview only after authoritative active-run check returns idle.
- [ ] Real native/mobile input, tray navigation, active output and cancellation
      evidence. No claim of complete Cursor parity without matched measurements.

## Verified implementation checkpoint

Collaborator tray and exact mobile invocation navigation are implemented.
Review caught and fixed an A→B→A collapse reset bug. Eight actual-component
Chromium/WebKit light/dark mouse/touch configurations pass geometry, draft,
focus and keyboard tests; these fixtures do not establish full ChatSession
scroll performance or Cursor parity.

The isolated steering ledger has request/checkpoint round-trip coverage,
idempotent receipt handling and tool-boundary validation. Review caught and
fixed assistant array messages crossing an unresolved tool call. Runtime
inbox, worker integration, approval handling and transcript materialization
remain incomplete; steering is not enabled. Full release gates follow.

The next source milestone adds service-only durable receipt intake/status and
a captured-authority server bridge. Intake requires an explicit worker
capability which no runtime currently enables. Legacy checkpoint admission,
disable and finish clear that capability. Reservation, application acknowledgement,
HTTP moderation, provider/checkpoint transcript integration and composer receipt
presentation are still required before enabling non-interrupting steering.

Queue rejection now preserves drafts/files, including batched capacity and
account-change cases. Replacement submission and Send-now fail closed when
durable cancellation is unconfirmed, including malformed HTTP 200 responses.
The separate queue removal-before-dispatch-acknowledgement gap remains open.

Next milestone in source: an atomic step preparation freezes FIFO receipt
membership, including the empty set, before a provider step. Same-original
recovery preserves that membership and the original intake identities. Legacy
entry/mark/save/finish paths must not strand accepted inputs, even after disable
clears the live capability. This remains disabled until checkpoint application,
terminal receipt accounting and runtime integration are implemented.

Transport acceptance validation and checkpoint assistant-array tool boundaries
are tightened independently. An SDK sendMessage promise is not an acceptance
receipt: automatic queue draining still needs transport-level acknowledgement
with owner/chat/attempt-scoped dispatch state before removing an entry.
