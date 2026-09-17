# Durable foreground-command resource journal

Backend foundation for recovery after worker loss. This does not yet enable automatic recovery or change the worker launch path.

- A service-authenticated launch reservation belongs to an exact user, chat, claim generation, run and sandbox. Only the first committed reservation authorizes launch; replay never grants a second launch.
- Reservation requires an active claim with required, unconfirmed cleanup and no cancellation marker.
- Reserved and started resources block generic cleanup confirmation. Direct state-index queries cannot miss a pending resource after a long completed history.
- Start/exit receipts bind a positive safe-integer PID to an opaque, remotely verified process identity. PID alone is insufficient. The trusted caller remains responsible for obtaining actual identity and exit evidence.
- Historical receipts survive Stop/claim replacement but cannot update the successor claim.
- An unacknowledged reservation cannot be marked exited. It deliberately stays uncertain.
- Legacy claims without the journal flag retain their existing behavior; claim generation replacement resets the flag.

## Verification

14 new regression cases failed before implementation; all 70 claim/journal tests passed afterward. Cases cover pre-start uncertainty, duplicate admission, late start after Stop, mismatched owner/run/claim/sandbox, process identity mismatch, invalid PID, historical receipts, more than 300 completed resources, and cancellation fencing.

## Required next integration

Deploy backend additions before changing the watched worker source. The worker must reserve before starting a command and persist remotely verified start/exit receipts. A remote launch fence/supervisor is still required to prevent late accepted launches after cleanup. An independent reconciler must verify process identity and remote closure; neither terminal worker state nor missing transport is exit proof. Persistent previews require separate lifecycle handling. No live hard-worker-death recovery is claimed by this change.
