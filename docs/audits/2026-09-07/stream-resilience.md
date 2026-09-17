# Stream resilience — frontend audit

Scope: `/Users/cetto/.codex/worktrees/rift/reference-ui`, 2026-09-07. Source inspection, focused React tests, and the installed AI SDK's actual reader lifecycle. No live chat was submitted, canceled, restarted, or mutated by this audit lane. Native/network operational QA belongs to the root task.

## Fixed

| Failure | Cause | Change and verification |
| --- | --- | --- |
| Foreground offline/online or laptop wake retained a dead reader, especially a run started on `/` or `/studio`. | Wake listeners depended on initial-page `autoResume`; online did not replace an SDK reader still labeled streaming. | `useAutoResume` distinguishes initial reattachment from recovery of a locally observed run. Online, long-hidden return and bfcache restore can abort only the local subscriber. Short healthy tab switches and submitted POSTs are left alone. |
| Two readers could overlap after waking and duplicate the answer or clear each other's SDK state. | SDK `stop()` resolves before the old response finalizer, and `resumeStream()` does not stop the existing reader. | Recovery waits for observed ready/error and any earlier resume promise to settle, coalesces hints, and observes explicit user Stop/new submission/unmount. A real-SDK test proves `abort-requested → old-finished → reconnect → new-finished`, one POST, one GET, and exactly one `Hello world` answer. |
| User Stop could be undone by a later online/visibility event. | Recovery did not consult the existing manual-stop ref. | Initial and event-driven recovery check that ref; pending recovery checks it again before attaching. No producer cancellation endpoint is used by recovery. |
| A completed-offline answer remained visibly truncated. | Hydration skipped updates while streaming, never retried on idle, and treated equal IDs/part counts as equal content. | `usePersistedChatMessages` retries on idle and compares semantic content. It accepts longer text, completed tool results and durable metadata while retaining newer local prefixes, optimistic turns, local ordering and stream-only usage totals. |
| New home chats had no durable state subscription until successful completion. | Both Convex queries were gated exclusively by `isExistingChat`, which only becomes true when the final URL is promoted. | A matching submitted persistent run enables the two read-only queries and hydration before awaiting its POST acknowledgement or promoting the URL. Temporary requests, stale request chat IDs and unmounted instances are excluded. Existing preference restoration and Chat-not-found gating retain their original condition. |
| A half-open resume GET could remain pending forever. | Resume fetches had retry counts but no per-request deadline. | Three read-only GET attempts, each with a 15s header deadline, with 1s/3s cancellable backoff (about 49s maximum setup wait). Failed/204 resumes leave the existing answer intact. There is no automatic start POST retry. |

During reader replacement, `StreamEffects` holds auto-continuation's status at streaming. The intermediate idle state produced by a subscriber abort therefore cannot dispatch a new continuation run.

## Trace and limits

- Persistent page reload: wait for chat metadata; attach only when the server reports an active producer. Initial submitted/streaming ownership does not open another reader.
- Offline: do not start a resume lookup while the browser reports offline. Recovery has no interval/polling loop. Deferred recovery waits until visible/online, and wake hints within one second coalesce.
- Worker finishes offline: release a stale reader, do not start another run when the active mapping is gone, and hydrate its saved final transcript. The existing resume endpoint returns 204 for no live run; final persistence is supplied by Convex.
- The installed Trigger SDK already retries transient stream read failures with a cursor and exponential delay capped at 5s. Its default retry count is unlimited; this patch does not add a second stream retry loop. Fatal run statuses/auth failures remain distinct from connection recovery.
- After bounded resume setup failures, the existing connection-loss message is still shown. This is not evidence that the durable worker failed; the worker lifecycle is independent.
- Lost POST acknowledgement: observe the submitted persistent chat before awaiting the response. Once the SDK reports a recognized connection failure and Convex confirms a durable producer, perform at most one automatic GET recovery per local send. Generic provider/run errors and unconfirmed producers do not trigger this recovery; the start POST is never retried.
- An already running development session does not retroactively execute newly introduced submission observation after HMR. This audit does not claim that source tests establish the state of the user's live in-progress run.

## Verification

Red regressions reproduced home/online recovery, explicit Stop revival, attaching while offline, releasing a completed-offline reader, stale final hydration, same-count tool completion and indefinitely stalled resume setup. Related green suites include:

- `app/hooks/__tests__/useAutoResume.test.tsx`
- `app/hooks/__tests__/useAutoResume.recovery.test.tsx`
- `app/hooks/__tests__/useAutoResume.sdk.test.tsx`
- `app/hooks/__tests__/useAutoResume.duplicate-response.test.tsx`
- `app/hooks/__tests__/usePersistedChatMessages.test.tsx`
- `app/hooks/__tests__/useAutoContinue.test.ts`
- `lib/chat/__tests__/agent-long-transport.test.ts`
- `app/components/__tests__/chat.integration.test.tsx`

The Chat integration harness required using Jest's global mock identifier so SWC hoists its mocks, and retaining real unmocked client-storage exports. The new integration tests assert that the previously dormant home subscription becomes active while its POST acknowledgement is still pending, survives a rejected acknowledgement, and excludes temporary/unrelated requests.

Final targeted verification: 8 suites / 91 tests passed. ESLint passed for all touched TypeScript files; scoped `git diff --check` passed. The recovery suite was rerun after the final new-send budget reset (10 tests passed). Unified TypeScript validation belongs to the root task.

## Sidebar destination follow-up

Read-only diagnosis found the ORBIT conversation absent from the current deployment: the service lookup returned success/null twice without lookup errors, while the sidebar was showing its independent run-history record. Its provenance remains unknown; this does not establish whether its worker is alive or whether the original request was temporary, deleted, or produced elsewhere.

The sidebar now reuses the already deployed, owner-checked `chats:getChatByIdFromClient` query through bounded `useQueries` subscriptions for its live candidates. Confirmed missing/owner-rejected chats have no Active row or broken destination. Pending or failed checks keep the recorded run visible with navigation disabled; a valid result immediately enables its conversation. Filtering precedes the five-row cap so orphan candidates do not crowd out real conversations. Runs/Activity queries and all run/chat mutations remain unchanged. No deployment was performed.

Five regressions failed before the fix. Final verification: `SidebarActiveRuns.test.tsx` and `chat.integration.test.tsx`, 2 suites / 27 tests passed; targeted ESLint and scoped diff-check passed. Modified source/test files: `app/components/SidebarActiveRuns.tsx`, `app/components/__tests__/SidebarActiveRuns.test.tsx`, and the test-only `__mocks__/convex-react.ts` default for the existing Convex `useQueries` hook.
