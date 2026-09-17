# Durable steering for active Build runs

Status: runtime progression authorized. The ordered utility is complete. The current milestone adds only service-key-protected receipt intake/status, schema and a captured-authority backend bridge; intake requires explicit `steering_enabled: 1` and `execution_tracking: 1` on the active checkpoint. Existing workers do not set the steering flag. No HTTP/UI activation, worker input consumption, approval change, deployment or process-reuse change is part of this milestone.

## Desired behavior and current evidence

Submitting text during an active persistent Build run should deliver a correction to that same run at its next closed model-step boundary. It must not cancel the run, repeat an earlier tool, or report receipt as proof that a model has acted on it. Show separate “Received”, “Applying after current step”, and “Applied” states. Explicit Stop remains cancellation; “Queue next task” remains a distinct option.

Current implementation is local queue/restart behavior:

- `app/hooks/useChatHandlers.ts:470-506` queues while streaming or cancels then sends. Native composer excludes `submitted`; console includes it.
- `app/components/chat.tsx:1561-1615` drains an in-memory queue only when this chat is mounted and ready; the queue does not run on a server.
- `app/hooks/useConversationQueue.ts` isolates queues by account/chat, preserves route switches, and caps each chat at ten. Reload loses the queue. A rejected full queue currently returns void and the submit handler still clears the draft.
- `app/components/ChatInput/SubmitStopButton.tsx` shows Stop while active, leaving Enter as the ordinary queue affordance. `ChatInput.tsx:237` excludes startup/submitted.
- `trigger/agent-long.ts:970` reads history during startup; `lib/api/agent-stream-runner.ts:499-660` prepares later requests from SDK history, reminders and summaries. There is no durable user-input inbox.
- `lib/agent/checkpoint.ts:134-166` combines initial history with the SDK's cumulative generated response tail. Injecting text only in prepareStep would omit it from checkpoints and subsequent requests.

## Alternatives and decision

1. **Durable inbox plus closed-step insertion ledger (recommended).** Reuses the existing run, claims, tool results and cancellation fences. Requires coordinated history/checkpoint integration and an honest waiting state during a running tool.
2. **Cancel and restart.** Already partially implemented, but adds startup delay and loses uninterrupted execution. Retain as an explicit control, not steering.
3. **Only append text in prepareStep or a mutable prompt ref.** Small patch, unsafe: later SDK steps and crash recovery can lose/reorder the instruction. Rejected.

The first runtime slice supports moderated text steering for persistent Build runs with active checkpoint tracking. Files remain intact in the existing next-task queue until the attachment intake described below is implemented. Temporary chats and runs with checkpoint tracking disabled return an explicit unsupported response and preserve the draft; they do not silently reinterpret steering as cancellation. This capability boundary must be visible before submission.

## Durable inbox and authorization

Add `agent_run_inputs` with owner/chat/original request identity, target claim/run, server-assigned monotonic sequence, client request ID, immutable payload hash and text, accepted timestamp, status, reserved step, response offset, and applied checkpoint step. Index by owner/chat/original request/sequence and by owner/chat/client request ID. Keep pending count and token/byte caps in the transaction; do not rely on frontend limits.

`POST /api/agent-long/input` authenticates using the existing request auth. Caller sends chat ID, observed run/claim identity, client request ID and payload. Never trust a caller-supplied owner. Validate owner and current active claim before moderation; apply existing moderation/input-token policy without a model/tool side effect. Then a Convex mutation rechecks owner, active target, cancellation, checkpoint support and capacity before accepting. Stale target returns 409 with no enqueue to a newer run. Same idempotency key + same hash returns the original receipt; a changed payload conflicts. Look up idempotent receipts before rejecting a now-finished target so network retries can recover an already-accepted result, after authenticating ownership.

Do not expose an unaudited client-accessible mutation that bypasses moderation. Backend mutations use the captured per-run DB client/service key. The existing service-key pattern and claim predicates are reused; each mutation rejects duplicate/ambiguous claim rows. Reading delivery status is authenticated and owner-scoped. No message contents, secrets or signing URLs in telemetry.

Concurrent devices for one owner can enqueue; the transaction assigns total ordering. Other users cannot enqueue, query, claim or acknowledge. Retrying a network request does not create another instruction. Disconnecting the originating tab has no effect after acceptance.

## Original request identity and ordering

Pin the original `requestMessageId`, request hash, model, purpose, permissions, project namespace and execution target for the run. Steering changes instructions, not authority or configuration. Do not append a steering instruction as a new normal latest user request while checkpoint `beginRun` uses the original request identity. Restart/resume remains attached to the original logical request, even if a replacement physical run is permitted by current recovery checks.

Use a pure ledger:

```
buildSteeredHistory({
  initialMessages,             // original or restored canonical prefix
  responseMessages,            // SDK cumulative generated tail since that prefix
  insertions,                  // id, sequence, afterResponseMessageCount, text
  includedThroughSequence,     // watermark already present in initialMessages
}) -> { messages, includedThroughSequence, insertedIds }
```

A response offset is a count in the canonical cumulative generated tail, not the pruned provider prompt, UI parts, token count or step index. An insertion goes after a complete response boundary, never between a tool call and its result. Multiple instructions at the same boundary are sequence ordered. Exact duplicate receipts are no-ops; conflicting ID/sequence/payload/offset combinations fail closed. Offsets must be monotonic in sequence order and in bounds. Preserve original message objects/provider metadata; do not synthesize missing results or alter tool IDs. A caller must capture immutable canonical SDK messages, not later-mutated objects.

Use the same reconstructed canonical history for EVERY model request and EVERY completed checkpoint. Provider formatting, cache breakpoints, pruning and context summarization are separate derived views. A summary must record the steering watermark/canonical prefix it covers; injecting into only the summarized branch is forbidden. New input is counted against context before the next request and must not be immediately summarized away or silently truncated.

## Claim, acknowledgement and restart semantics

Extend the existing checkpoint transaction boundary, not an independent best-effort acknowledgement:

1. At a closed step, `reserveInputsForStep` verifies the active owner/claim/run and prior completed step. It reserves a bounded FIFO set and records their immutable response offsets plus step input watermark. Repeating the same reservation returns exactly that set. Inputs arriving later wait for the following boundary.
2. Before any provider call, atomically persist the prepared-step input reservation and the existing in-flight marker. Build the canonical request from the ledger. No reservation means no instruction may appear in that request.
3. Existing `markExecution` remains a durable barrier before state-changing tool work. Never move it behind execution.
4. `saveStep` atomically stores the completed canonical checkpoint AND advances the applied steering watermark/status. Only then report Applied. Duplicate identical saves are idempotent; conflicting saves or old claims fail.
5. On restart, restore the canonical checkpoint and its applied watermark. Ignore insertion rows already covered by that prefix. Rebind remaining reservations to a new physical claim/run only through the same original-request recovery transaction. Old workers cannot ack or mutate them.
6. If a provider request failed before execution, the same reserved inputs may be reconstructed deterministically at the same offset. If an executing step exceeds the completed checkpoint, preserve the existing blocked recovery rule: reconcile explicitly, never replay uncertain tools. An inbox is not an exactly-once tool execution mechanism.

“Exactly once” means one accepted receipt, one canonical insertion and one durable acknowledgement. It does not mean one provider invocation or universal exactly-once side effects. Crashes can occur after a provider received a request; existing execution fencing decides whether recovery is allowed.

At final model stop, atomically close input acceptance only if there are no pending/reserved inputs. If input won the transaction race, continue the SAME run with the new canonical user input even when the previous model response said stop. Respect cancellation, budget and max-duration gates. This continuation must carry cumulative usage/tool state and bypass the existing `already-finished` checkpoint interpretation only through an explicit input-bearing continuation state. If closure won, enqueue responds run-finished and the composer preserves the draft/offers a next turn. Never auto-start an unscoped replacement job. On failure/cancellation, expose remaining entries as undelivered and retain them for owner-directed retry; do not silently retarget them.

If checkpoint size/model incompatibility disables recovery during a run, stop admitting new steering; accepted but unacknowledged entries remain visible as undelivered unless safely completed and atomically recorded. Initial runtime support must not consume without the durable representation.

## Transcript persistence and UI

The canonical ordered history is distinct from the SDK's single streaming assistant bubble. Persist a steering sidecar with the assistant transcript: immutable receipt IDs/text, sequence, consumed step and closed response boundary. This sidecar is committed with checkpoint acknowledgement, and copied with the final assistant persistence transaction. In-progress receipt status is read from the inbox, not inferred from SDK status.

Add a pure materialization layer for later model history and presentation that splits assistant/tool segments only at recorded closed boundaries and interleaves the corresponding user instructions. Persist a deterministic mapping from canonical response offsets to completed UI step boundaries when the step is saved; raw UI part indexes are not a substitute for response offsets. Preserve tool call/result pairs, signatures, images, costs and stable original message identity. Checkpoint recovery already contains these instructions, so that path uses its watermark and must not append the sidecar again. Ordinary new-turn history loading materializes the sidecar exactly once. Editing/branching a steering segment requires an explicit follow-up design; do not pretend it is an independently stored original request.

This transcript/materialization work is a launch dependency, not optional polish. Persisting each received input as a normal timestamped user message while one older assistant bubble continues would reorder history and break original-request recovery.

## Attachments

For the first runtime slice, a composer submission containing attachments stays on the existing queue path with its files and draft intact and the label “Queue next task”; a text submission can explicitly select “Steer current run”. Do not strip attachments and send only text. Never upload or stage an attachment as a side effect of a rejected steering request.

A later supported attachment intake must reuse initial-turn ownership/media validation, moderation, token limits, URL refresh, local-file grants and sandbox path preparation. The immutable inbox payload stores durable file identities, not expiring signed URLs, caller-owned arbitrary paths or secret grant tokens. Stage only into the SAME pinned run namespace and target after live ownership/grant checks; persist preparation outcome idempotently. A revoked local grant or oversize attachment leaves the entry undelivered with a visible error. Current file extraction/cache code cannot by itself supply this contract. Temporary chat support similarly requires a deliberate retention and recovery policy before storing durable inbox content.

## Active approvals and tools

Steering never approves an action, changes an existing approval's arguments or interrupts an executing command implicitly. A running tool may finish before the next model step. The UI must state that boundary.

For a pending approval, accepted steering transactionally supersedes pending approvals for the same run/step. Add an explicit `superseded` reason tied to the input receipt; the gate consumes it as a closed “not executed: new user instruction” tool result and allows the next model step. Existing denied/expired/canceled behavior remains stopped; do not turn generic authorization failures into successful tool results. Use a typed signal handled by the approval wrapper before the execution barrier. The model must issue a new tool call and obtain any required new approval after seeing the correction.

Approval-versus-steering races are decided transactionally: if pending approval was superseded first, approval is rejected and the tool cannot execute; if approval was already consumed/execution begun, the current action may finish and steering applies next. An approval request created later within a superseded step must also see that step's supersession watermark. Parallel tool calls already running are not rolled back. This requires tests through the actual tool wrapper; checking only inbox rows is insufficient.

## Concrete file map and review milestones

1. **Isolated ordering utility (complete):** new `lib/agent/steering-ledger.ts`, `lib/agent/__tests__/steering-ledger.test.ts`. RED ordering/duplicate/closed-history regressions, implement, GREEN, scoped lint. No runtime imports yet.
2. **Durable receipt/reservation contract:** `convex/schema.ts`, new `convex/agentRunInputs.ts` and tests; extend `convex/agentCheckpoints.ts`/tests for atomic prepared input and save/ack. Thin captured-authority bridge in new `lib/api/agent-run-inputs.ts`. Test races in one transactional backend harness.
3. **Authorized intake:** new `app/api/agent-long/input/route.ts`/tests. Reuse existing auth, moderation, admission and token-limit functions. Negative owner, stale target, canceled, unsupported, limit, altered retry-payload and moderated-denial cases must precede acceptance.
4. **Runner/checkpoint/transcript integration:** `lib/api/agent-stream-runner.ts`, `lib/agent/checkpoint.ts`, `trigger/agent-long.ts`; isolated transcript materializer and relevant `getMessagesByChatId`/final save paths. Avoid spreading implementation across unrelated tools. Deterministic fake-provider step tests prove current model request, saved checkpoint, reload and resumed request contain the same ordered inputs. Final-stop acceptance race must be tested before enabling intake.
5. **Approval supersession:** `convex/approvals.ts`, `lib/ai/approval/server.ts`, `lib/ai/approval/policy.ts`, relevant execution-barrier tests. Existing denied/expired cases stay stopped; old approved inputs are never rewritten.
6. **Composer/receipt UX:** `useChatHandlers.ts`, `ChatInput.tsx`, `SubmitStopButton.tsx`, current queue panel/context, chat transport/retained-session layer. Explicit steer/queue/stop intents; enabled submission during starting/streaming with honest eligibility; clear draft only after durable acceptance. Receipt view survives navigation/reload. Rejected retry preserves text/files. Verify desktop keyboard/IME/mobile and two concurrent owner tabs without paid models.

Runtime milestones 2–6 form one end-to-end feature gate. Current backend receipt contract: `enqueueForBackend` accepts captured service key, owner/chat/original request ID+hash, observed claim/run, client request ID, exact-text payload hash and text; `getForBackend` reads one receipt by captured owner/chat/client request ID. Neither returns text, payload hash or service key. Intake caps exact UTF-8 text at 16 KiB and pending plus reserved receipts at ten per original request; retrying an accepted receipt bypasses the new-intake cap and finished-run gate. `steering_next_sequence` is the next unused positive integer, initialized to one only for an empty original-request inbox. Counter corruption/ambiguity is rejected rather than repaired implicitly. The backend trusts its service caller to moderate and derive the payload hash before intake; it compares exact text as well as hash on retries. The bridge is not an HTTP endpoint. Do not ship a UI-only steer label, inbox-only acceptance, or prepareStep-only injection. They can be reviewed separately, but intake stays unavailable until the worker can consume, persist, recover and display it correctly.

## Required regression matrix

- FIFO at one/multiple closed offsets; reverse query order; identical retry; conflicting ID or sequence; invalid offsets; unresolved/orphan/mismatched/duplicate tools; preserved binary/provider metadata.
- Request reconstruction equals checkpoint reconstruction before and after each injection. Resume with watermark does not insert old inputs again. Repeated provider prepare callbacks do not duplicate input.
- Original request hash and identity remain stable across steering and recovery. Partial checkpoint/execution marker never replays a state-changing tool.
- Auth A/B, same-user multiple tabs, stale claim/run, logout, canceled run, admission/moderation/context rejection, no secret/payload telemetry.
- Crash before reserve, after reserve/before provider, after provider/before tools, after tool/before save, after atomic save/before response. Old worker ack rejected; valid owner retry receives original receipt.
- Input at final-stop boundary either continues same run or is explicitly rejected; never silently accepted and abandoned. Budget/duration stop reports undelivered inputs and no unpaid continuation.
- Approval pending/approved/consumed races; no execution after supersession; ordinary denial still halts; parallel already-running action may finish.
- Files are preserved on unsupported/rejected intake. No attachment filtering, queue overflow draft erasure or silent failed-send removal.
- Transcript reload/new turn/branch boundaries never duplicate the instruction or fabricate a tool result. Browser disconnect does not cancel an accepted steer.

## Self-review and unresolved integration work

The pure utility is not a security or delivery boundary and has no database, network, moderation, auth, checkpoint writer or mutable singleton. Its caller supplies the original prefix and trusted watermark; it cannot determine whether that prefix actually includes acknowledged inputs. Full integration must prove that binding transactionally.

The model may still complete its current step before consuming a correction; this design promises delivery at a boundary, not immediate tool interruption. Temporary chat and attached-file steering are explicit first-slice limitations. Canonical/UI segment mapping, stop-to-continuation checkpoint state, disabled-checkpoint behavior and typed approval supersession are concrete runtime work, not solved by the utility. No process reuse or weakening of lifecycle gates is part of this proposal.
