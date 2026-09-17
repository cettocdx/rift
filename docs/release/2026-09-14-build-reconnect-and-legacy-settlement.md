# Build reconnect evidence and legacy settlement acknowledgment

## Real three-minute command

On local production Preview at source `81b4157`, an authenticated isolated Build
run executed one Python command: print a marker, sleep 180 seconds, print another
marker. No files or external sites were touched. The UI stream observer was
aborted after the tool input event and resumed through the application endpoint.

- Chat: `8d65a294-6b68-4f0e-b685-1141a87d2751`
- Trigger run: `run_06g9pahvdhm29cku06o22f2901`
- Admission: 3.581 s; first tool input: 31.699 s; same-run resume: 36.658 s.
- Finish: 218.370 s; independently retrieved status: `COMPLETED`.
- Independent full-stream inspection found exactly one requested command,
  both output markers, the final response marker, and finish reason `stop`.
- Persistent provider usage: two distinct receipts, complete query page.

The observer process retained an SDK connection after completion; only that
test observer was terminated after independent run and usage verification.
No worker was stopped. This proves observer reconnect during a three-minute
command, not hosted worker death, OS sleep or physical network interruption.
Usage receipts prove cost observation, not balance settlement.

Timing separates causes: queue delay was 47 ms, attempt start to handler entry
13.688 s, handler setup 3.267 s. This development worker's startup is material;
the 31.699 s tool event must not be described as acceptable startup or as first
text latency. Cold startup remains unresolved.

## Legacy settlement acknowledgment

The legacy bucket finalizer swallowed thrown debit/refund errors and ignored
unsuccessful personal/team overflow results. Four regression cases failed by
resolving successfully before the fix. They now propagate the unresolved result
to the existing single-flight finalizer, without retrying an unkeyed adjustment.
The focused bucket and finalizer wiring suites passed 69 tests.

This does not add a durable legacy settlement ledger, atomic multi-store
transactions, or recovery of past uncertain charges. Those remain necessary.
