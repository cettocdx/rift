# Independent remote exit receipt reconciliation

This change recovers persisted foreground-command exit evidence independently of the agent worker. Stop schedules reconciliation after its response when cleanup remains pending. It does not claim full task cleanup, release a claim, restart commands, or certify unjournaled PTY/MCP resources.

The reconciler verifies the exact terminal Trigger producer and owner/chat/claim/run binding, paginates both pending resource states, verifies sandbox ownership and running state before connecting, and accepts only matching supervised final receipts with descendantsReaped=true. Missing evidence, failed persistence, identity mismatch and unavailable sandboxes retain uncertainty.

## Validation

- Focused backend, reconciliation and cancellation tests: 121 passed before the complete commit gate.
- TypeScript passed; the new owner-scoped backend inventory API was deployed to the development backend before use.
- Live isolated run `run_06g9qoqe5setekoia63ul3ia01`: deliberately reserved a command, let its real supervisor exit, and withheld its backend start/exit acknowledgement. Stop returned 202 cleanup_pending. After producer completion, the actual server adapter recovered one receipt with zero unresolved resources.
- Retained Trigger UI stream contained start and abort, with no tool invocation. The only injected command was a completed `printf` supervisor. Final worker metadata and the committed finalizer control flow showed completion through the claim receipt stage without a cleanup exception. Only this isolated test claim was then confirmed/released administratively, after pending inventories were empty.
- Evidence: `/tmp/rift-live-exit-reconciliation-proof.json` and `/tmp/rift-live-exit-reconciliation-stream.json` (local diagnostic files, not release assets).

## Limits

The Next.js post-response callback is covered by a route test; the live test invoked the same adapter directly because the previous Preview build was still running. Reconciliation has a cooperative 10-second budget, not a strict bound on every in-flight provider/network request. A paused or missing sandbox remains unresolved. Automatic full claim recovery after worker loss, persistent PTYs and other cleanup evidence remain separate work.
