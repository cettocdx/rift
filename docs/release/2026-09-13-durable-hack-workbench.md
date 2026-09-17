# Durable Hack Workbench execution — 13 September 2026

## Problem and behavior

Hack Workbench previously used the bounded `/api/hack-chat` HTTP producer. Its report reserve improved finalization but did not make the producer independent of the request connection. The new dedicated `/api/hack-long` path dispatches one `hack-long` worker and returns a read-only stream handle. Reconnection observes the same producer; it does not replay the POST or start a replacement security task.

The generic Build route and worker still reject security-purpose requests. The dedicated path accepts only a user-initiated persistent cloud assessment. It validates current Max access, suspension state, ownership, configured backend, the saved user message, project, scope annotation, model selection and approval mode. Receipt fingerprints and atomic execution claims bind those settings before work starts. Per-step and tool checks verify current access and checkpoint fencing. Scope is user-supplied context, not proof of permission or a replacement for tool authorization.

Completed steps and uncertain-effect markers use the existing durable checkpoint store. An uncertain tool outcome blocks replay. Dedicated Hack does not automatically continue in another task or switch the configured model. Provider-reported aliases are telemetry; they do not change the bound model selection. Oversized checkpoints stop the assessment instead of silently removing its effect protection.

## Client lifecycle

- POST uses the dedicated path only when server rollout is enabled. Lost dispatch responses are recovered by the exact saved receipt, never by resending the request.
- GET reconnects through the dedicated owner-checked resume endpoint. A known legacy HTTP stream can still be observed after a 204, without starting work.
- Existing durable run IDs keep observation available when new admissions are disabled.
- Replay resets only the matching assistant response; earlier conversation messages are preserved.
- Pending reconnect readers are cancelable. Stop uses the existing owner-checked cancellation endpoint, requires a confirmed outcome, and offers retry if acknowledgment fails or times out. New input remains blocked while Stop is unconfirmed.
- The Workbench continues to use an isolated cloud sandbox instead of inheriting the unrelated Build Local preference.
- Time/context-limit run receipts now use neutral wording rather than promising an automatic continuation that may not exist.

## Rollout and verification boundaries

Both `RIFT_DURABLE_HACK_ENABLED=true` and `RIFT_DURABLE_DISPATCH_ADMISSION=true` are required for new dedicated admissions. The page reads these server-side at request time. Deploy the `subscriptions:getEntitlementsForBackend` Convex query and register the `hack-long` worker before enabling the UI route. Observation and cancellation must remain available for an existing run during rollback.

Focused verification so far: 29 server/checkpoint/usage suites (461 tests) and 9 client/outcome suites (208 tests; 205 in the initial combined run plus three additional transport fault cases) pass. These are unit/integration checks, not a live provider or native-client endurance measurement. Gate results and runtime rollout are recorded below as they occur.

A reconnect only survives loss of the subscriber while the worker is still alive. It does not restart a terminated worker. No guarantee of zero outages is made. Scope is restored from the admitted receipt on reconnect; it is not yet a separately persisted presentation field for all historical Workbench sessions. GitHub live consent remains separately blocked by GitHub's account re-verification screen.

## Follow-up gate

The initial Stop race before an execution claim has been allocated needs separate fault-injection verification. The handler checks the request abort signal after access checks and before dispatch, but a `no_active_run` cancellation result alone does not fence a still-arriving request if subscriber disconnection is not propagated. Do not interpret the tested claimed-startup cancellation path as proof for this earlier window. Keep dedicated admissions disabled until this window has been addressed and the deployment has passed a bounded live dispatch/reconnect/Stop exercise.

The proposed follow-up is a compact Stop tombstone keyed by authenticated owner, chat and client dispatch ID. Stop must persist before admission and election must read it atomically, with subsequent claim attachment/dispatch/worker activation fenced too. It must not cancel a predecessor or a later request sharing the chat. A lost Stop response must be safely repeatable; accepted-run receipts must survive the race. Do not expire these markers unless server-side admission expiry makes delayed copies permanently inadmissible. Required tests pause POST before admission, race Stop against every transition, lose Trigger/Stop acknowledgments, and verify wrong-owner rejection and no effects after delayed activation. This protocol is a reviewed next step, not implemented in this change.

Final source TypeScript validation passed before the commit hook. The new endpoint is included in logger, tracer, usage tracker and Convex usage validators. Checkpoint and platform aborts are classified separately from a user Stop; the latter requires exact claim cancellation evidence and is latched through terminal cleanup.

## Exact-dispatch Stop follow-up

The pre-admission Stop race is now fenced in source. `/api/hack-long/cancel` persists an owner/chat/dispatch tombstone before inspecting producer state. Election, claim attachment, dispatch permission and worker activation check that same permanent fence. Tombstones do not expire while delayed requests remain admissible.

The initial implementation confirmed Stop when no producer was permitted, or the bound accepted Trigger producer was terminal. The remote-cleanup follow-up below strengthens the second condition: Trigger terminality alone is insufficient. A dispatch already handed to Trigger with an unknown outcome returns HTTP 202 and `canceled:false`; a lost response or absent active-chat mapping never implies successful cancellation. Acceptance receipts remain recordable after Stop so retry can reconcile the original producer. Only the originating server attempt may record proof that Trigger was never invoked.

The client captures the user-message dispatch ID before POST admission. A retained session owns its producer kind and pending/failed Stop state. Navigation and newer history do not change the identity targeted by Retry Stop. A confirmed canceled receipt (including POST conflict and lost POST response recovery) closes the reader without another task submission or Trigger subscription. Exact durable Stop never invokes the chat-wide legacy cancellation mutation.

Validation includes a real handler paused before election, the real Stop mutation, and resumed admission with no Trigger dispatch, persistence or tool execution; atomic transition races, ownership isolation, late acceptance, lost Stop response, disabled rollout cancellation, and actual retained-hook unmount/remount with newer history. Server focused results: 24 suites / 439 tests. Client focused results: 7 suites / 183 tests before final full-hook validation.

Rollout remains disabled. Hosted Convex/Trigger cancellation and bounded live execution still need verification before enablement. The existing HTTP producer still uses its legacy chat-wide Stop protocol; upgrading that protocol requires exact stream identity through both Convex mutation and Redis notification, and is separate from this durable request fence. These changes do not establish zero outages or complete production readiness.

Full validation for `c8dcd88`: the required pre-commit hook passed lint-staged, local CLI package verification, TypeScript, all 764 Jest suites, 7,687 tests (one skipped) and 24 snapshots in 94.222 seconds. Log: `/tmp/rift-exact-stop-commit.log`. Convex dev deployment added the `agent_dispatch_stops.by_owner_chat_dispatch` index and completed in 12.9 seconds (`/tmp/rift-exact-stop-convex-deploy.log`). Its generated API declaration is included in the follow-up source commit.

The production Preview build succeeded with the same runtime source and generated declarations (`/tmp/rift-exact-stop-build.log`), output `.next-ui-release-1789287353240-94270598`. Neither success enables the rollout flags or proves hosted cancellation behavior. Before restart, obtain a fresh run-gate result; the earlier no-active-claims result is not a lease.

## Exact identity for the HTTP transport

The persistent HTTP Hack route now requires a per-send `executionId`. Preparing
an explicit send creates the ID once; retrying delivery keeps it. Temporary
chats and other HTTP chat routes retain their existing transport contracts.
Already-running legacy streams can still be stopped through their old path.

Admission, Stop intent and producer acknowledgment are stored separately from
chat-wide cancellation flags. Only the first admitted caller may execute or
finalize a generation. HTTP and durable admission read the same indexed HTTP
head, preventing overlapping producer kinds. An old unscoped cancellation or
late stream registration cannot overwrite an active exact HTTP generation.

The producer registers cancellation before preflight effects, checks ownership
before model/tool steps, and binds its stream to the execution ID. Redis carries
only scoped hints; bounded durable polling continues even when Redis appears
healthy. A missing Redis acknowledgment during reconnect does not prove producer
termination and cannot remove a running execution's mapping. Metadata cleanup
uses the observed stream ID; terminal acknowledgment comes after persistence,
usage settlement and resource cleanup.

Stop returns pending until cleanup is acknowledged. The client waits within a
bounded window on that same ID; it never replays commands to confirm Stop.
Unavailable authority or an unacknowledged process death must remain unconfirmed.
This is not automatic recovery from an HTTP process crash: a hard-killed
producer cannot provide terminal acknowledgment, and a clock alone must not
release its execution head. Durable Hack rollout remains separately gated.

Focused verification exercises the real HTTP admission handler and reconnect
route, deferred PTY cleanup, actual Convex mutation transitions, legacy/durable
exclusion, transport acknowledgments, retained UI state, missed Redis hints,
stalled durable reads and deferred tools. Tool execution is wrapped inside the
existing registry builder so MCP discovery retains its live registry identity.
The drain waits before message/usage finalization; UI stream closure is not
used as proof that tool execution settled.

PTY cleanup for exact HTTP work uses an owner/chat/execution scope. Its proof
ledger outlives canceled handle creation and the legacy bounded session cache.
Terminal shutdown and tool draining start together, so a tool awaiting terminal
exit cannot deadlock cleanup. New terminal creation is sealed before waiting;
only confirmed adapter exit permits acknowledgment. Adapter disconnects,
normalized null results from transport errors, and cleanup timers are not exit
proof. The legacy terminal UI retains its bounded cleanup behavior.

## Durable remote-cleanup acknowledgment

Fault injection reproduced a separate gap in the dedicated worker: legacy PTY
cleanup could return after its two-second cache timeout while a remote process
had not exited. A terminal Trigger receipt could then confirm Stop and admit a
successor. This is independent of the already-fixed pre-admission Stop race.

New trusted Hack dispatches require cleanup acknowledgment. Dispatch permission
sets an indexed pending fence; only the exact owner/chat/dispatch/claim/run
acknowledgment clears it after the worker seals tools, joins their actual
settlement and confirms remote PTY exit. Tool drain and PTY shutdown start
together. The same wrapper reaches tools discovered later through the registry.
The worker attempts final usage persistence after tools settle, even when exit
proof is pending or rejected. It cannot acknowledge cleanup or release ownership
without that proof. The cleanup receipt confirms resource settlement, not
successful billing. A genuinely hung tool or failed accounting write still needs
durable usage reconciliation; in-memory counters are not a persisted ledger.

`CANCELED`, `COMPLETED`, `CRASHED` and `TIMED_OUT` remain producer observations;
they do not prove remote cleanup. Pending receipts block replacement durable
claims and HTTP/legacy producers even if a chat mapping has been cleared. Lost
cleanup responses are safely repeatable using the same bound receipt. Existing
Build runs keep their previous cleanup contract.

This source change does not resolve a hard-killed worker's unknown remote state.
It deliberately preserves that fence. Early worker authorization/setup failure
before its finalizer is registered also needs an authoritative no-effects or
cleanup reconciliation path. Rollout flags remain disabled; hosted worker death,
remote-exit proof and client reconnect/Stop acceptance remain release gates.

## Admission settlement during rollback

A fault-injection test reproduced a gate stranded in `dispatching` when the
admission flag was disabled between dispatch and its acceptance/terminal receipt.
The flag governs new admission; it must not disable settlement of issued work.
Exact receipt settlement now releases its matching gate even during rollback.
Repeated terminal evidence can repair a previously stranded matching gate.
Revoked gates and successor dispatches are unchanged. Remote cleanup remains
separate: a crashed Hack receipt with pending cleanup still prevents a successor.

Focused coverage includes disable → receipt → enable → next admission, repeated
receipt delivery, newer-gate isolation, Stop revocation and pending remote cleanup.
The legacy test fixture now includes the admission tables queried during rollback.
This does not resolve pre-authorization worker death or prove hosted acceptance.

## Optional startup annotation failures

The worker awaited dashboard tag repair before its main finalizer. A rejecting
SDK call therefore aborted setup; a stalled tag request delayed startup without
any execution requirement. `ensureRunTags` now skips already-present tags and
bounds missing-tag repair to 250ms. SDK exceptions and late transport rejection
are observed as optional annotation outcomes, not execution failures. This
bounded wait is for metadata only and is never used as remote cleanup evidence.

Fault injection covers synchronous SDK failure, rejected transport, a hung
request with late rejection, timer cleanup and already-tagged dispatches.
This removes the tag-service dependency; authorization failures and hard worker
death before finalizer registration still require the separate exclusive-entry
protocol described below.

## Exclusive early worker entry (source implementation)

New cleanup-required admission receipts carry a trusted lifecycle version. A
worker now acquires an exclusive receipt-bound invocation nonce before live
entitlement checks. Entry is identity only; an irreversible effects-start marker
and the same nonce are required before worker activation. The route's earlier
claim activation is not evidence that tools have started.

Authorization, initial abort and setup errors before finalizer handoff can record
no-effects cleanup using that exact entry. Cleanup remains available after Stop
or rollout disablement, releases only the matching claim/mapping and is safely
repeatable. Duplicate invocations, mismatched owner/payload/run/nonce and legacy
receipts cannot use this path. Once effects are permitted, the main finalizer
must drain tools and confirm remote PTY exit before cleanup acknowledgment.

Focused tests: 6 suites, 123 tests passed. They exercise the actual mutation
handlers with an in-memory database double and the worker wrapper with injected
transport failures. They do not prove hosted transaction races, process death or
remote cleanup. Unknown entry acknowledgments and hard death remain fenced;
rollout flags stay disabled pending hosted acceptance. The live worker's backend
must support the new protocol before durable Hack rollout.

## Remaining accounting boundary

The original `hasRecordedUsage` flag was set before debit acknowledgment.
[Terminal single-flight finalization](2026-09-13-terminal-usage-single-flight.md)
now shares the pending/rejected outcome between in-process finalizers. Retrying
the unkeyed debit remains unsafe after response loss. A durable,
immutable per-run settlement intent and atomic same-key debit acknowledgment are
required before retrying. Pending/unknown settlement must remain visible for
reconciliation; cost observation and confirmed balance debit are different facts.
Do not claim this accounting migration is implemented by the startup annotation
change.
