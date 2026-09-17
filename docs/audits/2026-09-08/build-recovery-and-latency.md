# Build recovery and latency — 8 September 2026

Applied in the reference UI checkout and its Convex development deployment.
The Trigger development worker reloads this checkout. No production rollout is claimed.

## Findings and changes

- A newly activated task could inherit `canceled_at` / discard intent from a previous task. Claim activation now clears only cancellation older than the new reservation. A Stop during startup remains effective; stale owners cannot clear it.
- Checkpoints marked a step in flight before the model produced tool arguments. A disconnect while merely generating arguments was indistinguishable from a tool whose side effect might already have occurred. New workers opt into durable execution tracking: a separate owner-fenced barrier is crossed after approval, immediately before tool execution. Recovery may restart a model-only step from completed history. Legacy checkpoints and uncertain executed actions still cannot be blindly replayed. Duplicate workers are rejected even before the first completed step.
- Checkpoint admission now precedes credit reservation, MCP connections, and sandbox startup. Blocked requests do not perform that unnecessary setup.
- The error Retry button previously resubmitted the same blocked request. For interrupted/uncertain Build errors, **Inspect and continue** now sends a new, visible reconciliation request and retains completed evidence. This action is user initiated; it does not automatically repeat commands or edits.
- Every short request advertised 121 enabled MCP tool schemas. The worker still connects enabled servers to obtain their current schemas, but now advertises one discovery tool and exposes at most six matches per search. Selected tools retain their existing approval gates. Profile restrictions are applied before opening connections; disallowed tools cannot be discovered. Selection survives provider tool-set rebuilds and is isolated per conversation.
- Token estimation excluded call metadata but still counted result metadata containing opaque provider signatures. Result metadata is now excluded from semantic token estimation, without modifying the original message or signed provider history.
- Delegated high-effort calls had a 4,000-token total output ceiling, including reasoning, and a live delegate failed with `AI_NoOutputGeneratedError`. The ceiling is now 16,000 to leave room for the structured result. Existing 90-second, total-token, cost, step, and tool limits remain. This corrects an undersized budget; it does not guarantee every provider will return valid structured output.

## Verification

- TypeScript `tsc --noEmit`: passed.
- 111 tests across 12 suites: passed. Covers stale cancellation versus startup Stop, legacy ambiguous replay, execution barriers, completed-edit preservation, duplicate ownership, approval ordering, MCP discovery/profile restrictions, token estimates, delegates, and retry UI/handler.
- Live no-action requests through the authenticated console endpoint and the shared Build worker completed successfully.
  - Earlier comparable GPT-5.6 Sol request: 58,814 input tokens; stream duration 13,252 ms.
  - First revised request: 18,148 input tokens; stream duration 8,736 ms; end-to-end 17,446 ms.
  - Second revised request: end-to-end 17,006 ms.
  - These are individual observations, not a percentile benchmark. Cache conditions differ (earlier request mostly cached; first revised request uncached). No guaranteed cost or end-to-end speed reduction is inferred.
- Live read-only tool request used `list_files`, saved a completed two-step checkpoint, and finished in 22,054 ms. No user project was edited by these probes.

## Remaining boundaries

The initial MCP connections are still eager. Provider latency, connector failures, cloud setup, and chosen reasoning strength still affect wall time. The changes reduce unnecessary model input and remove incorrect recovery blocks; they do not make distributed execution interruption-proof or guarantee instant responses. Existing ambiguous checkpoints remain protected. The new Inspect and continue action lets the user request reconciliation from actual saved state.
