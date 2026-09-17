# Durable provider usage observations

The shared web and Build/Hack runner now persists each observed main-model
finish receipt before forwarding that finish frame. Previously these receipts
only survived in worker memory until terminal accounting ran.

The backend transaction accepts an immutable receipt ID. An identical retry is
a no-op; reuse with different ownership, run, model or usage is rejected. Reads
and writes require the backend service key. No prompt, tool output or secret is
stored in this table. A missing provider cost remains unknown; explicit zero is
preserved.

The client retries the same receipt up to three times with a three-second
acknowledgment timeout per attempt. Failure aborts further model steps while
retaining the observed usage in stream state. Earlier streamed tool calls may
already have executed; the finish barrier does not promise otherwise.

## Verification

- Tests cover delayed persistence, duplicate finish frames, conflicting replay,
  invalid numeric usage, unauthorized calls and lost acknowledgments.
- Runner tests verify per-step receipts without double accumulation and no next
  model request when persistence fails.
- On the development Convex deployment, eight concurrent replays produced one
  row, three conflicting replays were rejected, and a fresh client read it back.
- A separate controlled writer process was killed with SIGKILL after its receipt
  committed. A fresh client recovered exactly one receipt. This is not a full
  Trigger Build worker termination test. Synthetic verification rows used zero
  cost and did not invoke billing or a model provider.

## Remaining boundaries

This is an observation journal, not a debit or an automatic settlement system.
Do not sum receipts blindly into customer charges: fallback billing has distinct
rules. Atomic keyed settlement and reconciliation remain separate work.

Receipts cover main-model calls in the shared runner, not summaries, media,
sandbox costs or the console endpoint. A process dying before a provider finish
does not produce an invented receipt. Identity is stable across storage retries,
not across arbitrary reconstructed provider responses after process restart.

The additive schema and functions were deployed to the development Convex
environment before runner wiring. Production rollout is not established by this
document. Durable dispatch feature flags remain unchanged.
