# Separate worker module evaluation from startup latency

Previous Build evidence showed 13.688 seconds from attempt start to handler
entry. That number does not identify an import bottleneck. A dependency-free
first import now starts a process-local probe, closed after task registration.
The immutable evaluation window is included in existing run startup metadata.
Warm invocations retain the original window rather than timing it again.
Only bounded timestamps and duration are copied; no payload or credentials.

This window excludes fetching/parsing before probe evaluation, earlier shared
chunks and any platform startup. Generated development bundle inspection found
the probe before the bulk of the task chunk, including tokenizer evaluation,
but after its initial shared imports. It is not a complete import profiler.

Live development run `run_06g9pff2ttrf6kss0sc23c6101` completed and published:

- Attempt start to handler entry: 2.358 s.
- Process uptime at entry: 775 ms.
- Probe evaluation window: 172 ms.
- Handler setup: 2.339 s; moderation: 1.550 s.
- Route admission: 3.853 s; first tool event: 12.263 s.
- Observer reconnect retained the run; finish arrived at 18.370 s.

The run executed an isolated one-second sleep command. Its completed Trigger
state was independently retrieved before terminating the retained observer
socket. The difference from the previous 180-second test is not an optimization
claim: workload and machine conditions differ, and only instrumentation changed.
Startup remains above target. Next measurements must compare repeated identical
workloads and separate platform/process startup from model latency.

Fifteen focused tests passed, including first-import/registration wiring,
immutable warm reuse, bounded metadata and existing entry timing behavior.
