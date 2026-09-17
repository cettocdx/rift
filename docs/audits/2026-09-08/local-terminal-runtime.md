# Independent local RIFT terminal

The installed `rift` launcher now defaults to a local tool loop. `rift --cloud` retains the independent durable Build worker. The two paths have separate history and neither submits into the open app chat.

## Measured cause and result

Previous standalone CLI used the Cloud worker path, including job acceptance, context/tool startup and remote orchestration. One measured simple no-tool request: initialization 806 ms, POST acceptance 3492 ms, first text 18737 ms from launch, completion 19471 ms. This measurement does not separately isolate provider latency or each worker startup cost.

The new local gateway bypasses worker/sandbox startup. Same default GPT-5.6 Sol / Medium simple no-tool test: configuration 558 ms, first text 4868 ms from launch, completion 5150 ms. One sample is not a latency guarantee. Provider and network latency remain.

A real model then read a temporary `fixture.txt`, changed `status: before` to `status: after`, and read it again to verify `keep: unchanged`. The original local file was verified from disk. No cloud sandbox or app conversation was used. A real PTY also returned `LOCAL TTY OK`; exiting and reopening restored that transcript without resubmission.

## Implementation

- Local client owns the model/tool loop, file access, shell execution and approvals.
- Gateway authenticates the same RIFT account, uses the Build model/effort registry, reserves/reconciles credits, and returns one model step. No server-side execution of caller tool requests.
- Project-root AGENTS.md is loaded. Text history is saved atomically with owner-only permissions and a per-directory writer lock.
- Local file tools reject traversal and symlink escapes. Shell commands use normal OS permissions, not an OS sandbox.
- Review first, Allow edits and Run freely are enforced locally. Large previews are rejected instead of silently truncating an action for approval.
- Interrupted tool intent is persisted. Restart never automatically replays an uncertain operation. Stop aborts the model request and shell process group.
- Terminal rendering writes only changed rows and caches wrapping of unchanged transcript entries.

## Verification

35 CLI tests passed, including live shell termination, path boundaries, approvals, denial, crash recovery, stream truncation and incremental redraw. 93 focused application/gateway tests passed. Root and console TypeScript checks passed. Dev Convex schema accepts the model-gateway usage endpoint.

## Current limits

The new model gateway is available on the local UI Preview service at localhost:3020, not yet deployed to the public service. The desktop window need not stay open, but the model service must be reachable. The in-app agent console continues to use its independent Cloud runtime. Local CLI offers five core file/command tools; it does not yet provide full app MCP/subagent/browser feature parity. Local exit stops local work; Cloud exit detaches from durable work. Local history is restored, but crashed commands are not automatically resumed. Context uses model registry limits and conservative input estimation; there is no automatic local compaction yet.
