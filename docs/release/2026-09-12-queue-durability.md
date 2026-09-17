# Queued follow-up durability

## Current integration status

The disabled `RIFT_DURABLE_DISPATCH_ADMISSION` rollout now connects ordinary persisted user messages to admission, stable Trigger idempotency, and durable acceptance receipts in POST plus worker startup. Regenerate, auto-continue and temporary migration remain on the legacy path and must be integrated before general activation. A separate authenticated receipt GET reads the exact owner/chat/message request without new-task entitlement/billing or substituting the chat's newest run. The client now has gated, bounded receipt recovery for ambiguous startup delivery.

Do not enable this rollout yet: real transaction concurrency, lifecycle terminal reconciliation, retained/abandoned intent recovery, all legacy cancellation paths, and client persistence remain outstanding. No remote schema deployment or runtime restart was performed for this stage. The historical sections below describe earlier foundation stages.

## Verified current behavior

`useConversationQueue` retains conversation queues in a React Map, not durable
storage. Page navigation preserves it while the authenticated shell remains
mounted; refresh/restart does not. Transport acceptance is observed separately
from execution completion. An ambiguous result remains `unconfirmed` and blocks
automatic replay. This is not a durable server receipt.

Auth refresh previously kept the cached owner eligible to dispatch. Regression
tests demonstrated both a new and retained claim callback could send while auth
was unresolved, and an existing Send now claim remained current after auth
became unresolved. Dispatch now requires the latest committed resolved owner.
Drafts remain visible; a canceled-but-not-dispatched claim restores its queue
entry, rather than leaving it stuck as sending.

## Required persistence integration (not yet implemented)

1. Persist an owner/conversation/message UUID record before acknowledging enqueue.
   The caller clears its composer after acceptance, so failed writes must retain
   the draft. Include model, purpose, mode and execution target semantics explicitly.
2. Persist an atomic claim before transport dispatch. Multi-window access requires
   transactional claims/revisions; whole-map localStorage writes can lose changes
   or resurrect removed entries. Prefer a server-owned queue for background work.
3. Preserve a stable server dispatch identity derived from owner, conversation and
   queued message UUID. The current agent-start reservation uses a fresh start
   claim; transcript deduplication alone is not proof of single execution.
4. Reconcile ambiguous delivery with an authoritative acceptance record. Never
   restore an interrupted sending record as automatically pending. Expired leases
   do not prove the server rejected work.
5. Whitelist attachment metadata. Never persist transient localPath. Resolve
   localAttachmentId through the owning desktop; represent missing attachments
   visibly and do not silently omit them. Cloud file IDs require ownership checks.
6. Hydrate only after authentication resolves, retire stale callbacks/subscriptions,
   and define explicit logout deletion policy. Verify user isolation and quota errors.
7. Test restart at every write/claim/send/receipt boundary, simultaneous windows,
   lost responses, explicit logout/account switch, quota denial, file recovery,
   and task execution once despite retry. Then verify against actual server runs.

Browser storage alone cannot make inactive conversations execute in the background.
This work must integrate with the durable task service before claiming restart-safe,
automatic queued execution. The current auth fix is a prerequisite, not completion
of the persistence work.

## Additive ledger foundation

The source now contains `agent_dispatch_requests` plus service-authorized
`agentDispatchRequests` create/read/dispatch-transition/acceptance/terminal
operations. It retains logical request identity separately from replaceable
worker claims. `markDispatching` grants permission only on the first reserved
transition. Existing accepted/terminal records cannot be downgraded or rebound
to another run. A terminal receipt is actual terminal status, not inferred success.

`agent-dispatch-identity` builds an owner/chat/request-scoped stable key and a
canonical digest of normalized semantic JSON. The caller must resolve defaults,
freeze execution settings and strip timing/tokens/transient paths first. The
ledger stores no raw prompt, attachment source path or public token.

This is a foundation, not activated queue recovery. Route/worker/transport have
not been wired and the schema has not been remotely deployed. Current create
requires an existing starting claim; claim reservation and receipt creation are
still separate mutations. Before activation add atomic admission, look up repeats
before any cancellation, bind acceptance from worker and route, and add a
request-specific receipt endpoint. Then integrate durable client enqueue and
reconciliation. Handler tests use an in-memory database double; they do not prove
Convex transactional concurrency. Real simultaneous-request, lost-response and
restart tests remain mandatory. No automatic replay is authorized by this stage.

## Atomic admission foundation (not enabled)

Added persistent request intents and a per-chat admission gate. Election precedes replacement cancellation; duplicate requests obtain no dispatch authority. Cancellation targets the immutable predecessor. Claim reservation and receipt creation share one mutation; dispatch requires the elected attempt. Stop revokes pending admission, including before a worker claim exists. Receipt evidence cannot reopen a revoked intent or release a newer gate.

Legacy reservation paths now deny admission while a gate is held. Legacy replacement cancellation explicitly identifies its purpose and cannot revoke another pending request; exact-current user Stop revokes it. Four new handler regressions failed before these guards and passed after them; stale Stop is separately covered. These tests use database doubles, not real concurrent Convex transactions.

All new APIs and legacy gate checks use `RIFT_DURABLE_DISPATCH_ADMISSION=true`, disabled by default. This foundation is not deployed, called by routes, or enabled. Before activation, wire server-generated attempts and canonical payload fingerprints, stable provider idempotency, receipt reconciliation, worker fencing, and durable client storage. Audit all legacy/migration cancellation paths, including runs without claim rows. Validate concurrent transactions and interrupted dispatch against a real test deployment. Trusted `confirmedTerminalRunId` requires authoritative provider evidence. Do not disable the flag with outstanding intents. No automatic timeout takeover is allowed; ambiguous dispatch must be reconciled, never blindly retried.

## Replacement endpoint consolidation

Removed the endpoint's early replacement-cancellation branch. It duplicated the shared acquisition path and could cancel a healthy run before discovering an unavailable local replacement target. A regression demonstrated an actual remote-cancel mock call despite local admission returning 400; it now preserves the prior run. An online target is validated and closed before shared acquisition. Read-only busy responses remain for nonreplacement requests. The shared acquisition path retains exact-claim cancellation checks and the explicit replacement reason.

This changes the real route, not only the disabled admission foundation. It does not finish durable request wiring. Legacy tagged temporary runs without claim rows still need a complete migration/fencing strategy before enabling admission globally.

## Server and worker receipt wiring

For eligible ordinary turns, a stable last-user message ID identifies the request; normalized execution inputs are hashed after removing desktop source paths. Preflight checks existing receipts before local target presence probing. Atomic election still runs after a null preflight, closing the read/election race. Duplicate accepted requests mint a fresh read-only token directly; they never enter startup-finalizer cleanup. A lost acceptance remains pending rather than dispatching again.

New requests verify the immutable predecessor using authoritative Trigger retrieval, including a second retrieval after cancellation; unknown/404/error states do not permit attachment. A nonreplacement busy election can only be rejected while positively undispatched, before cancellation authorization or receipt creation. The same rejected ID stays revoked; safe retry UX is still required.

The route records acceptance immediately after Trigger returns. The worker repeats this exact binding before activation so a lost route response can be recovered. Receipt writes propagate failure instead of reporting successful durable bookkeeping. `/api/agent-long/receipt` authenticates the owner, preserves terminal evidence already present, and returns `unconfirmed` when no bound run exists. It does not infer terminality, submit work or grant retry authority.

## Bounded client receipt recovery

Behind `NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION=true`, ordinary persisted sends perform one exact-request GET after network/start timeout, generic 5xx, dispatch-pending response, or malformed successful run handle. The original POST is never repeated. Only an accepted receipt matching the original dispatch ID with a valid run/token can resume streaming. Missing, failed, mismatched or unconfirmed reads preserve the original failure. Local Stop prevents recovery and interrupts an in-progress lookup, including fetch implementations that ignore abort. The lookup is bounded to three seconds including response-body reading.

This does not persist the React queue across app restart or reconcile old terminal statuses. Client and server flags remain disabled and must be coordinated with schema and worker deployment only after real fault/concurrency and all entry-path coverage. A later focus/restart recovery policy remains necessary for acceptance that becomes known after the bounded lookup.

## Terminal evidence on receipt lookup

Receipt GET now refreshes the exact accepted run against Trigger, in parallel with read-token preparation. Only the seven explicitly recognized terminal statuses are persisted with the receipt's existing claim/run binding. Cached terminal evidence skips repeat provider reads. Active, unknown, 404, failed or over-one-second provider lookups never become completion or retry permission; accepted access is retained with `statusFresh:false` when freshness is unavailable. Late retrieval results cannot mutate the receipt after the deadline. Backend ownership/binding/write rejections propagate rather than serving a stale authorization or claiming a successful terminal write.

This is lookup-driven reconciliation, not complete event-driven lifecycle capture. A run whose receipt is never queried may remain accepted until a later read. General rollout still requires all entry paths, durable client queue, account-switch recovery and real concurrency/fault validation.
