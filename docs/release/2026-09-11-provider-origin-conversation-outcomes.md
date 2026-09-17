# Provider origin and truthful conversation outcomes

## Provider isolation

Worker scope now captures an immutable allowlist of OpenAI endpoint/key/organization/project and OpenRouter key. The shared context reader remains Node-free. A missing scoped value never borrows a later run's environment. Bound worker callbacks restore this scope alongside Convex and Redis.

Moderation reuses the last matching explicit SDK configuration; tracked/untracked providers bind returned models to their origin. Global myProvider binds when selecting a model. The generation-metadata finish callback captures the originating key when the stream is created, including explicit missing-key behavior. No credentials are copied to logs, task payloads or reports.

Actual SDK requests with an HTTP stub reproduced seven origin failures before the fix; two late metadata cases also failed before the fix. Focused verification passed125 tests across14 distinct suites and TypeScript. This is offline isolation evidence, not a throughput improvement. PostHog queues, media/search tool credentials and other run-time destinations remain separate work; process reuse remains disabled.

## Conversation outcome reconciliation

The previous sidebar resolver treated an ended run plus a retained active pointer as disconnected. Separate chat/run subscription updates could therefore show Needs attention for known completed work. It could also apply an older run's failed/approval state to a replacement claim.

The resolver now matches the active Trigger run ID and chat identity before using the run's status. Completed/cancelled outcomes remain terminal while pointer cleanup catches up; genuine drafts still appear. Failed and completed-with-warnings states remain visible, and warnings participate in the attention filter. An old outcome cannot hide a replacement's running state or create a false approval. The hook selects the exact active run before using timestamp ordering. Opaque legacy streams remain uncorrelated and retain stale-pointer handling.

Regression tests cover completion before cleanup, terminal status before ended_at, active replacement, cross-chat input, warning outcomes, opaque streams and independently arriving subscriptions. Initial pure resolver7cases failed and hook identity selection1case failed; final focused UI set43tests passed. Full release gates and live/native evidence are recorded in the external progress report.

## Scope limits

This change does not prove full native/mobile acceptance, production credential rotation or safe warm-worker reuse. No existing errors are hidden; only outcomes from the corresponding run determine its display. Startup and other release goals remain open.
