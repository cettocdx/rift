# Shared RIFT execution and startup audit

Implemented in the active `reference-ui` checkout and installed as local CLI 0.2.3. The existing UI Preview web service and durable development worker picked up the server changes. No public production deployment was performed.

## Execution architecture

Main app runs and local CLI model steps now enter Vercel AI SDK through `lib/ai/harness-model.ts`. This shared boundary preserves SDK lifecycle callbacks, cancellation, target-specific retry limits, and provider message preparation. Anthropic system/history cache breakpoints now also apply to local CLI requests.

The app still owns its durable multi-step run and executes approved tools in its selected environment. The CLI still owns its local loop and executes reviewed file/shell actions on the user's computer. These target-specific dispatch and persistence layers have not been replaced by one server-side filesystem executor. This distinction preserves local operation and the existing durable worker ownership fences.

The installed AI SDK 6 `ToolLoopAgent` settings omit the app's required `onChunk`, `onError`, and `onAbort` hooks. Both paths therefore use the shared `streamText` driver directly; the CLI adapter retains its single-step, schema-only contract. Remote model execution never acquires local file tools.

## Changes and evidence

| Area | Previous behavior | Current behavior |
| --- | --- | --- |
| MCP startup | All enabled eligible transports connected before model execution | Registry read only; discovery connects at most three matching servers and selects at most six matching tools per search |
| MCP authority | Checked during eager loading | Re-read at actual connection time; profile/read-only filtering and approval/journal wrappers reapplied before tools enter the SDK's stable set |
| MCP lifecycle | Eager connection teardown | Run-scoped connection deduplication; late connections close after cancellation/teardown; unrelated servers never dialed |
| CLI repeated failures | A scripted failing action consumed all 80 steps | Shared app/CLI detector warns at three matching occurrences and halts at five; changed read results count as progress |
| Reused tool identities | CLI fixture executed two duplicate calls per step, 160 executions across 80 steps | Whole CLI batch rejected before any execution; shared run ledger coalesces identical calls and refuses conflicting identities without replaying failed effects |
| Temporary worker chats | Worker read only DB history even though temporary user messages were never persisted; live probe failed with empty-message 400 | Worker uses temporary payload messages on initial fetch and context retargeting; persistent requests still avoid duplicate user messages |

MCP discovery retains the existing OAuth/credential revision checks, owner filtering, namespace rules, unhealthy-server cooldown and transport cleanup. No credentials or cross-user connections are cached by the new layer.

## Live checks

One local file task using Sol/medium completed in **11,007 ms**, with four model requests, three local tools and zero errors. It read `note.txt`, changed `status: before` to `status: after`, preserved `keep: unchanged`, and read back the result. Three completed tool results were present in the saved local state. First assistant text arrived at 10,603 ms; preceding tool activity is distinct from assistant text. This is a single sample, not a latency percentile or a before/after benchmark.

The temporary worker probe initially failed before reaching the model. After the input fix, a fresh temporary arithmetic request completed:

- HTTP admission: 1,674 ms.
- Worker model request: 4,995 ms after worker startup.
- First model chunk: 6,835 ms after worker startup; may include reasoning.
- MCP registry preparation: **181 ms**, with no discovery/transport connection required.
- Moderation: 3,487 ms, overlapping other preflight work.
- Observed end-to-end completion: 11,875 ms, including polling.

Earlier startup tracing identified a 6,008 ms eager MCP phase on a different run. The new path removes that handshake from unrelated task startup, but these different prompts/runs are not a controlled global speed comparison. Provider and moderation latency remain; changing the SDK cannot remove them.

## Verification and limits

- **483 Jest tests passed across 45 suites:** app loop, SDK endpoint, MCP discovery/credentials, tool policy/verification/delegation, worker ownership and checkpoints.
- **46 standalone CLI tests passed**, including interrupted execution, denial, stream cancellation, batch validation and repeated-work handling.
- TypeScript `--noEmit` and standalone CLI compilation passed.
- Installed `rift --version` reports **0.2.3**; `rift --json doctor` confirms local-tool-loop configuration. Doctor is a configuration check; the live task above separately verified the model service and real local edits.

The execution ledger is per run, not a persistent exactly-once guarantee. An uncertain side effect after a process crash still requires state inspection rather than blind replay. Existing durable checkpoints and ownership/cancellation fences remain authoritative. Local CLI still requires a reachable authenticated RIFT model service; these changes do not make it offline or make service outages impossible.
