# Fresh reservation queue isolation

Fresh route reservation uses `skipQueue: true` on the Convex HTTP client. This prevents another request's queued writes on the shared server client from delaying reservation. Prior cancellation, terminal liveness and cleanup checks remain awaited. The backend transaction retains its observed-generation comparison and ownership checks. Scheduled legacy reservations and cleanup writes are unchanged.

74 focused tests passed, including an installed-Convex-SDK test holding an unrelated mutation pending while reservation starts. The same test verifies backend CAS rejection still raises AgentRunBusyError. Scoped lint and a fresh production build passed.

This removes a queue dependency; it does not establish that every observed latency spike came from that queue. It does not remove model, network or worker latency, and does not establish the under-four-second target.

## Live preview verification

Published `.next-ui-release-1789382690150-pre-effects` after idle/cleanup checks. Startup warmup confirmed ready. Three persisted build-codex/medium scenarios completed and verified with zero duplicates.

| Scenario    | First text ms | Dispatch-to-handler ms | Ownership wait ms |
| ----------- | ------------: | ---------------------: | ----------------: |
| greeting    |         21893 |                  15035 |               208 |
| explanation |         20976 |                   1376 |              5601 |
| terminal    |         17022 |                   1588 |               157 |

Evidence: `/tmp/rift-reservation-isolation-20260914.json`. Terminal first text may follow command execution. No consistent end-to-end speed improvement is demonstrated. The first run shows a large worker-entry delay; the second shows ownership latency even with skipQueue, so queue removal does not explain or fix all spikes. Installed Trigger development pool has a hardcoded 30-second idle timeout; process reuse is not an always-ready worker. Dependencies were not patched. Under-four-second target remains unmet.
