# Startup latency — 2026-09-10

## Changes
- After owner-bound claim activation, start read-only entitlement and usage-configuration preparation alongside customization, balance and history loading. Await successful preparation before any free-run lock or usage reservation. No ownership, billing or cancellation check was removed.
- For server-verified fresh standalone greetings only, use conservative moderation framing (`shouldUncensorResponse: false`) instead of waiting for the external classification used for authorization reinforcement. The helper independently verifies exact greeting content. Instructions, attachments, project/profile context and continuations retain the existing path. Selected model and reasoning effort are unchanged.

## Verification
- 30 tests across preparation, moderation, standalone greeting, tracked billing and startup finalization passed; TypeScript and targeted ESLint passed.
- Same production frontend localhost:3020, persisted new chats, `merhaba`, build-codex, medium reasoning, 746 system-prompt tokens. Three sequential samples per stage, all completed without duplicate stream events.
- Before (worker .21): first-text median 10,847 ms, range 10,801–17,986; worker model-request median 2,984 ms.
- Parallel preparation only (.22): first-text median 8,686 ms; worker model-request median 1,592 ms.
- Final (.23): first-text median 7,224 ms, range 6,793–8,046; worker model-request median 1,254 ms. Greeting moderation measured 0–1 ms. Live worker .23 is active; existing runs were not canceled.

## Interpretation and remaining delay
Observed first-text median improved about 33%, worker preparation about 58%. These are small sequential live samples, not a controlled attribution of every millisecond: provider latency also fell between batches. Model request to first text still took 2.6–3.4 seconds in the final batch, plus route admission and dispatch/stream delivery. This does not establish that arbitrary tasks start in seven seconds or that startup latency is fully resolved. No UI-frame or competitor-parity claim is made.
