# Redis origin, history preparation and retained reading position

## Redis readiness for worker reuse

The existing process-wide Redis cache retained its first configuration forever. A missing initial configuration could remain unavailable after setup, while URL/token rotation could continue using an older connection. An offline regression reproduced six failures across seven initial cases before the fix.

The worker's existing AsyncLocalStorage lifecycle now captures a separate Redis context alongside its Convex context. The shared Redis accessor is Node-free; only the existing worker scope adapter imports AsyncLocalStorage. A missing scoped URL/key remains missing. Lazy clients are reused within the originating run, and bound cleanup restores that same context. Returned free-run lock callbacks already retain their originating client; the integration test now exercises A/B acquisition, refresh and release together.

Unscoped callers keep a single configuration-aware cache. A changed URL or token replaces the client, missing configuration clears it, and a constructor exception does not permanently cache unavailability. Existing Upstash and Vercel KV alias precedence is preserved. No credentials enter task payloads or evidence logs. Production fail-closed rate-limit policy is unchanged.

Focused verification: eight Redis-origin cases and existing rate-limit/Convex/authority/recorder regressions, 192 tests across17 suites, passed. Browser-platform bundling of the shared Redis accessor passed with no Node builtins. This is compatibility evidence, not a production Convex deployment. Process reuse remains disabled pending other provider/telemetry configuration and lifecycle checks.

## First-page history overlap

Free-tier runs need verified prepaid balance to determine context capacity. History loading now starts the first owner-filtered page while that capacity resolves, then waits before truncation or additional pagination. The first page is reused exactly once. Snapshot validation, ownership filters, temporary/client-regeneration behavior, error propagation and execution gates remain intact.

The deterministic tests exercise both free-tier capacity outcomes, query-count/output parity, rejected capacity, absent/temporary paths, snapshot rejection and scoped authority across later pages. 171 tests across7 suites passed at the focused checkpoint.

This does **not** establish a speed improvement for the previous paid/Max live sample. Paid runs already resolve the context-balance dependency immediately; their billing balance is parallel. The earlier internal ~82ms estimate for that sample was incorrect and is withdrawn. Any benefit here applies to free-tier capacity-dependent startup. The `historyFetch` measurement now includes any remaining capacity wait, so old/new values alone are not comparable.

## Long-chat route restoration

The actual-transcript fixture was extended with the real ChatViewStateProvider/useChatViewState and a conversation unmount/remount. Initial descendant geometry suggested a 2214px jump, but subsequent screenshot and hit testing showed that skipped content-visibility subtrees can report misleading descendant coordinates. That measurement is not treated as visual acceptance evidence. The stronger regression is the actual painted/hit message changing from transcript18 to transcript20 after return while the descendant geometry appeared correct.

Reading position now also retains a serializable, memory-only message/block anchor and viewport offset. Restoration looks up the one retained message and semantic block before placement; the existing resize anchor then handles late reflow. Only the restored anchor row is materialized; ordinary visible rows are not repeatedly pinned. Its original content-visibility value and priority are restored when that anchor is no longer needed, Latest is chosen or the hook unmounts. Observer-driven release is deferred one frame to avoid recursive ResizeObserver layout notifications; unmount cancels the pending frame and restores the style synchronously. The fingerprint is bounded; changed or ambiguous matches use the numeric fallback. Follow-to-bottom and explicit Latest retain their behavior. No detached DOM or transcript persistence is added to localStorage.

Final browser results and release gates are recorded in the external progress report after verification. This fixture does not prove native software-keyboard timing, full authenticated route integration or live-provider streaming performance.

## Startup phase attribution

Worker setup now publishes start/end/duration/outcome spans from a single monotonic origin through existing run metadata. Existing duration fields remain available. Tools construction, the final execution fence, turn sandbox preparation and system prompt preparation are included without moving execution or authorization gates. Inputs, results, errors and credentials are not captured.

The benchmark copies only named phases with bounded, consistent numeric spans and known outcomes. Overlap remains visible; parallel durations must not be summed or subtracted from wall-clock timestamps. Helper and worker contract tests passed (63 tests); 10 offline benchmark tests also passed, covering report inclusion and metadata exclusion. A throwing metadata publisher was reproduced in a failing test and isolated: diagnostics cannot fail successful work or replace original cancellation/authorization errors. Live attribution will be recorded after the release gate; this instrumentation alone is not evidence of lower latency.

## Cursor Agents reference

The native Cursor Agents window was inspected directly, including its add-context menu: one search field, compact mode/skill rows followed by files, model and MCP. Escape returns to the composer. A screenshot is retained in the external evidence directory. No IDE task or user repository edit was started. This is observed interaction evidence, not access to Cursor's private harness implementation or a comparative performance result.
