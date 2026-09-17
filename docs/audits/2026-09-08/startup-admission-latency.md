# Startup admission latency — 2026-09-08

The UI Preview startup path now avoids unnecessary serial work while retaining live authorization, billing gates, run ownership checks, and atomic run reservation.

## Changes

- Independent entitlement and chat reads run concurrently after authentication. Neither failure permits dispatch, mutation, or cancellation.
- Run claim and chat reads run concurrently. Existing-run checks still trigger a fresh chat read before reservation; the database transaction remains authoritative for ownership and expected run mapping.
- Temporary chats skip the redundant pre-save claim check because they do not save a message. The final pre-dispatch check remains. Persistent chats retain both checks.
- API-key validation bypasses the shared Convex client's unrelated mutation queue using the installed SDK's per-call `skipQueue` option. Validation itself remains live and awaited; revoked keys are still rejected.
- Trigger environment signing metadata is shared for 60 seconds, keyed by API URL and secret identity, with failed or malformed discovery evicted. Each authorized run receives a newly signed, read-only, run-specific six-hour token. No user authorization decisions or public run tokens are cached. The SDK handle's default token is not returned because its live scope/lifetime did not match this contract.
- The route reports phase durations through `Server-Timing`. The benchmark records timings and token scope/lifetime checks without storing credentials, token bodies, or conversation content.

## Live evidence

Fresh temporary `merhaba` requests against the correct local UI Preview, same `build-codex` model and medium effort, three samples per comparison:

| Measurement | Before | After |
| --- | ---: | ---: |
| Admission median | 2,973 ms | 1,793 ms |
| First text median | 8,890 ms | 7,137 ms |
| First text range | 7,670–10,844 ms | 6,105–7,398 ms |
| Completed runs | 3/3 | 3/3 |
| Duplicate stream events | 0 | 0 |

Admission was approximately 40% lower in this small sample. This is a development comparison, not a controlled production benchmark or a population p95 estimate. Provider/network variation and worker hot reload affect the result. First text measures arrival at the stream consumer, not desktop paint latency. The four-second first-response target is **not met**.

All three final live runs returned six-hour tokens with exactly one read scope for their own run. A separate disconnect/reconnect probe completed while the consumer was detached and replayed to completion without duplicate events. Its first-text timing includes intentional detachment and is excluded from the normal latency comparison. This does not establish uninterrupted execution during computer sleep or local runner shutdown.

Raw timing-only evidence: [before](startup-admission-before.json), [after](startup-admission-after.json), [disconnect recovery](startup-admission-recovery.json).

## Remaining latency

The final sample spent 1.7–2.5 seconds in worker preparation before requesting model generation. The interval from that marker to first text was another 1.7–2.3 seconds; it includes SDK preparation as well as provider work. Dispatch/start scheduling and transport add further latency. Admission and worker phases can overlap and must not be summed as if strictly sequential.

The remaining work needs separate measurements of moderation, worker scheduling, and actual provider time to first token. No model or effort downgrade was used for these gains. This change is local to UI Preview; it is not a production deployment or a full UI performance audit.

## Verification

The repeatable `node scripts/verify-harness.cjs` gate now includes agent startup ownership, live API-key validation, and database run-claim tests alongside the existing harness, CLI, and quality checks. It runs root typechecking, harness tests, CLI compilation and tests, and quality-checker tests. Token factory tests cover concurrent discovery, expiry, API URL and credential rotation, discovery rejection, and malformed metadata. The API-key queue test uses the real installed Convex client with a controlled fetch implementation.

Final gate passed: root typecheck; 668 harness tests in 60 suites; CLI compilation; 51 CLI tests; 5 quality-checker tests. This is the selected regression gate, not every test in the repository. Live probes above were run separately; the gate itself does not launch paid requests.
