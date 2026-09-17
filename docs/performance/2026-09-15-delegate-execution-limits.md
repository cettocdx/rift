# Delegate execution limits

The live Pixel activity panel for chat 41fd6299-a82f-4215-801b-e6d9b6b2a607 reported token-limit after 4 steps, 8 tool calls and 3 failed reads (~24 seconds). This was the delegate's cumulative 24,000-token policy, not a network disconnect. A separate saved Probe result also recorded token-limit at 28,443 input / 340 output tokens.

At the user's explicit request, delegate_task no longer imposes per-delegate time, cumulative tokens, model cost, step, tool-count, output-token, request-count or concurrency ceilings. Provider usage is still recorded once per receipt. Parent cancellation, server-owned roster/tool authorization and approval denial remain enforced. Tool output excerpts remain bounded with range reads available; this does not terminate execution. Provider context/rate limits and the parent run lifecycle still apply.

Validation: 28 tests passed across delegate-task, real SDK loop and provider receipt suites; TypeScript and targeted ESLint passed. Coverage includes more than six steps, twenty reads, more than four delegates, cumulative usage above 24k tokens, spend above $0.50, and cancellation after the former 90-second deadline. These are deterministic SDK tests, not proof of unlimited provider capacity.

Local worker 20260914.30 loaded the change. Existing runs may use their original worker revision. Desktop web production build is prepared separately; restart deferred while two unreleased active claims remain. Do not overwrite historical failed results or replay user actions to cosmetically erase them.
