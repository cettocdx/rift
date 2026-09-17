# Chat lifetime and navigation

The authenticated chat shell owns a `RetainedChatRegistry`. Build, Studio,
Plugins and other routes inside that shell attach views to a session; navigating
away detaches the view, not the SDK stream. This is memory state, scoped to the
authenticated account, with at most 40 idle sessions. Active readers and pending
continuations are not evicted.

## Execution

- The original SDK Chat instance owns messages, status and the current reader.
  Its UI callbacks are replaced on attachment and removed on detachment, so an
  old chat cannot update a newly opened chat's global UI state.
- The worker owns tool execution and persistence. Unmounting a route never
  issues a durable cancellation. Explicit Stop cancels both the session's
  continuation and the existing durable cancellation path.
- `RetainedContinuationController` handles the server's continuation signals
  even without an attached route. It waits for SDK completion, preserves the
  existing continuation bounds, deduplicates signals and retries only explicit
  `409 run_active` conflicts. It does not retry an ambiguous failed POST.
- Continuation uses an immutable snapshot of the original prepared request,
  including model, effort, permissions, execution target, project and working
  file. Fresh reconnects seed the snapshot from an allowlisted, owned worker
  payload before replay begins. One-request replacement/regeneration flags and
  old message envelopes are excluded.
- Pending continuation is a reactive session state. The UI remains busy during
  handoff, and queued user messages cannot race the next automatic leg.

## View restoration

`ChatViewStateProvider` retains chat metadata, loaded history size, presentation
state, preferences and scroll position. The first render reuses SDK messages;
it does not wait for a fresh paginated Convex query. Persisted messages may add
metadata but cannot roll back newer streamed progress. Plans are reconstructed
from retained `todo_write` parts, including updates produced while offscreen.

Queues are stored per conversation and are cleared on account changes. A queued
follow-up is dispatched when its chat view is attached; this differs from an
automatic continuation of the current task, which runs offscreen.

## Boundaries

Closing/reloading the entire app discards this memory cache. Durable worker
execution and existing reconnect support remain separate from view retention.
Network/offline recovery listeners still belong to the mounted chat; this change
does not promise offscreen reconnection after a real connection failure or
unlimited continuation. Older runs without a recoverable request payload can be
viewed but do not receive invented continuation settings.

## Verification

Real SDK controlled-stream tests cover route detachment, offscreen output,
continuation POSTs with frozen settings, Stop, pending-state notifications and
account disposal. Additional tests cover resume ownership, filtered context,
scroll restoration, plan progress, per-chat queues and project changes during
asynchronous working-file preflight. The local UI Preview was checked through
Studio → chat navigation; the test streams do not incur model usage.
