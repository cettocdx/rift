# Local terminal output flow control — 2026-09-11

## Scope and cause

The server-hosted Workbench terminal SSE path enqueued output directly from producer callbacks without respecting reader demand. The previous characterization measured 5,683,305 queued SSE bytes for 4,194,304 raw bytes while the reader was withheld, despite a separate 262,144-byte replay ring. A finite replay ring did not bound the already-enqueued HTTP frames.

Local node-pty exposes real pause/resume. The local adapter now offers an attachment-scoped output credit handle backed by those native operations. The SSE response uses a pull-only stream (high-water mark zero) when that capability exists, reads at most 65,536 raw bytes per frame, and pauses the producer while the attachment has not requested its next frame. Producer callbacks only pause and wake a pending read; they do not enqueue frames.

Independent attachment credits use the slowest-reader policy: a fast reader cannot resume a producer while another attachment remains paused. Cancel/abort disposes that attachment's credit and wakes its pending read. Input, resize and kill use their existing independent control operations. Exit and planned rotation follow pending output and carry the final delivered byte cursor.

This does not change the native desktop v2 terminal protocol. E2B's current callback transport has no equivalent supported pause operation, so cloud handles retain their existing SSE path. **The cloud slow-consumer backlog is still open.** Disconnecting the last attachment releases its pause; existing detached replay retention/truncation rules remain in force. This does not promise unlimited detached history or a bound on every browser, HTTP, OS or process-memory buffer.

## Verification

The actual Workbench SSE regression first failed because a withheld reader never paused its producer. After the fix it drains the complete Unicode byte sequence, without reset events, and emits exit after output. Other tests cover per-attachment credit isolation, bounded replay frames, planned rotation cursor/order, and abort/cancel cleanup. Existing remote terminal tests still pass through the unchanged transport path.

A standalone probe used the actual source local adapter, node-pty native module, session manager, and new stream adapter on macOS. It started a temporary local shell/Python producer, waited for readiness, withheld reads for 300 ms, then drained the output. Only Next's build-time `server-only` marker was replaced in the standalone test bundle; the PTY and stream implementations were real. The probe removed its temporary files and closed its own PTY.

| Measurement                                    |                                          Result |
| ---------------------------------------------- | ----------------------------------------------: |
| Total output                                   | 4,718,598 bytes (4.5 MiB plus readiness marker) |
| Additional bytes received during withheld read |                                               0 |
| Largest raw output frame observed              |                                     1,026 bytes |
| Peak retained raw replay ring                  |                                   262,144 bytes |
| Final absolute cursor                          |                                       4,718,598 |
| Reset events                                   |                                               0 |
| Exit code                                      |                                               0 |
| Full byte comparison                           |                                     Exact match |

SHA-256: `435ef704fa5b5e406717376100a7139acb7547c2d31a4635095374176a8f9789`.
This is one real-PTY flow-control experiment, not a general native-app or cloud benchmark.

Focused checks: 51 tests across four suites passed; TypeScript passed. Full suite with the bounded worker setting: **647 suites, 6,114 passed, one skipped, 24 snapshots**, 81.789 seconds, no forced-teardown warning in this run. Default Jest concurrency now matches the existing CI budget of two workers; command-line worker overrides remain available. The previous full run had three failures under concurrent desktop load, while the two affected suites passed serially without application-code changes. One clean run does not establish that every source of test flakiness is fixed.

Local evidence:

- `/tmp/rift-local-backpressure-red.log`
- `/tmp/rift-local-backpressure-green.log`
- `/tmp/rift-local-flow-focused.log`
- `/tmp/rift-local-flow-live.ts`
- `/tmp/rift-local-flow-live-result.json`
- `/tmp/rift-local-flow-tsc-final.log`
- `/tmp/rift-bounded-workers-full.log`

## Other remaining work checked this turn

The non-auto-reload atomic credit debit path was already implemented in `5368ce2`; it was not reimplemented. Old cancellation logs contain model cost for two of the three previously unresolved probes, but lack generation identifiers and complete sandbox cost receipts. Their historical account reconciliation remains unresolved; no manual refund or credit top-up was performed. Audit: `/tmp/rift-historical-stop-receipt-audit.json`.

Startup latency, durable accounting after hard process death, cloud PTY flow control, broad UX/release acceptance and signing remain separate open work. No sub-four-second startup or competitor-parity claim is made.
