# Provider reservation recovery — 2026-09-10

The user reported the exact temporary-capacity UI message. It is selected only for the in-flight reservation marker. The earlier diagnosis (`../2026-09-10-provider-capacity/report.md`) recorded HTTP 402, metadata.reason=in_flight_budget_exhausted and Retry-After=120. That change fixed classification but left the fetch/SDK execution path terminating immediately: the provider's 402 is not an ordinary SDK-retryable 429.

Read-only checks of the configured OpenRouter key and credits endpoints returned HTTP 200: key limit not exhausted, account balance positive. No account funds, caps, credentials or billing configuration were modified. These checks do not reveal the instantaneous reservation cap.

## Change
- The existing OpenRouter fetch boundary now recognizes this explicit HTTP 402 pre-generation rejection and honors Retry-After (HTTP header, metadata header, seconds or HTTP date).
- Up to two retries, within a five-minute cumulative wait budget; absent/invalid hints use bounded backoff. An excessive valid provider cooldown is not shortened.
- Only the rejected model request is resent with identical payload. No agent restart, tool replay, new run claim or new application credit reservation is performed by this recovery.
- Cancellation stops the cooldown immediately. Accepted HTTP 200/SSE streams, ambiguous connection failures and actual exhausted-credit 402s are not retried by this helper.
- App and durable worker emit a progress part while waiting; the live activity label says the provider wait resumes automatically. Each wait gets its own part ID; recovery resumes normal activity presentation. If recovery is exhausted the real error is still shown; the UI no longer invents a fixed additional couple-minute wait.

## Verification
117 targeted tests passed across seven suites, including a real Vercel AI SDK + OpenRouter adapter loop with simulated HTTP responses. A tool executes, the next model step is rejected with capacity, cooldown elapses, then the result completes with exactly one tool execution and identical retried request bodies. Other coverage: permanent credits, accepted streams, HTTP-date cooldown, cancellation, retry exhaustion and oversized cooldown.

Root TypeScript, scoped ESLint and the production UI Preview build passed. Fault injection uses fake timers and a fake HTTP transport; no upstream outage was induced and there is no claim that OpenRouter capacity has been eliminated. Official retry guidance: https://openrouter.ai/docs/api_reference/limits .

This handles the identified pre-generation reservation rejection. Mid-stream failures remain on the existing reconciliation path. The previous already-failed conversation is not silently replayed.

Final checks: full suite passed (611 suites, 5,365 tests passed, one skipped, 24 snapshots). Afterwards the SDK test was extended to cover both generateText and streamText; both variants passed with one tool execution. The frontend LaunchAgent was restarted on the successful production preview build; port 3020 returned HTTP 200. The existing development worker automatically rebuilt (20260910.28 observed). This is the user's local preview deployment, not promotion of a production worker.
