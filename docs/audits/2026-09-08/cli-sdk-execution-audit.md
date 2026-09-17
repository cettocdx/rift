# RIFT CLI and Vercel AI SDK execution audit

## Result

Installed RIFT CLI 0.2.2. The installed `rift` command launches a standalone Node process and terminal TUI, rather than forwarding input to the open desktop chat. Verified from a real pseudo-terminal and against the live authenticated preview model endpoint. No production deployment was performed.

The source of truth for this checkout is `packages/console`; installed launchers in `~/.local/bin` point to its compiled distribution. Existing running processes must exit and restart to load this update.

## SDK architecture traced

| Path | Model generation | Execution and lifetime |
| --- | --- | --- |
| Desktop/web Build | Vercel AI SDK 6.0.191, `streamText` in `lib/api/agent-stream-runner.ts`; SDK `DefaultChatTransport` on the client | Durable Build worker, RIFT approval/tool policies, ownership claims, context preparation, checkpoints and cancellation. |
| Default `rift` | Authenticated `/api/console/model`, one SDK `ToolLoopAgent` step with schema-only tools | The CLI owns its local tool loop, approval checks, file access, shell processes and project-specific history. No desktop pairing or cloud sandbox startup. |
| `rift --cloud` / in-app independent console | Independent console client and the Build API | Separate conversation identity. Stream recovery reads existing work rather than resubmitting the task. |
| `rift --pair` | Explicit legacy paired mode | Optional compatibility path; not the default CLI. |

Verified against installed SDK docs/source and the [provided Vercel AI SDK page](https://vercel.com/ai-sdk). SDK streaming provides model/transport primitives; durable execution, local file permissions, deduplication and recovery still belong to RIFT. Replacing those layers with a different UI wrapper would not fix their lifecycle errors.

## Defects reproduced and fixed

### Partial tool batches lost confirmed results

Previously all results in a local multi-tool step were appended after the entire batch. Stopping during tool two replaced tool one's known successful outcome with an uncertainty message. A process restart during the batch also had no durable result for tool one.

Now each completed result is persisted before the next action starts. Recovery preserves confirmed results and supplies uncertainty only for unresolved calls. It never automatically repeats a potentially completed side effect. The regression test failed with `Interrupted...` instead of `First edit succeeded`, then passed after the fix. A separate restart test verifies recovery of a partially checkpointed batch.

### SDK truncation looked like successful completion

The console endpoint previously emitted a complete step after a normal stream close even when the SDK finish reason was `length`, `content-filter`, `error` or `unknown`. That could expose proposed tool calls from a model step that did not finish successfully.

The endpoint now releases complete messages only after a successful `stop` or `tool-calls` finish; incomplete finishes take the error path. Four failing finish-reason regressions passed after the fix. Actual usage reconciliation remains in place.

### Interrupted reasoning remained visible

A failed model stream left its temporary Thinking row in the finished transcript. Stream cleanup now removes the transient row on failure and normal completion. The error/result remains visible. Reproduced with a thinking event followed by an error.

### Stop could leave an empty tool message

During batch checkpointing, stopping before the first approved operation could leave an empty tool-result message. Recovery now fills the existing tool-result message where appropriate. A regression verifies that saved history after Stop contains no empty tool messages.

## Live verification

All fixtures were isolated in `/tmp/rift-cli-audit.I0RWlM`. No user project files were modified by the agent under test.

1. Started installed `rift` in a real TTY. It initialized without opening/pairing a browser or desktop chat.
2. Asked it to read the local `audit.txt`. The transcript showed `Read audit.txt` and returned the exact fixture value `RIFT_LOCAL_CLI_VERIFIED_20260908`.
3. Exited normally; the alternate screen, cursor and terminal modes were restored.
4. Reopened through the local session implementation and issued a short, tool-free live model request. The endpoint returned HTTP 200 and the expected response, with zero errors.
5. Issued a focused edit-and-read task. The test harness approved only an edit/write of the isolated `audit.txt`; any other proposed operation would be denied. One approval was requested, the real file was changed and read back, and no errors occurred.

| Measurement | Observed |
| --- | --- |
| Local session ready, warmed service | 506 ms |
| Tool-free model first text | 4,258 ms |
| Tool-free model completion | 4,653 ms |
| Edit + approval + read-back completion | 9,430 ms |
| TTY typing samples | 26 |
| Keystroke-to-output p50 | 1.44 ms |
| Keystroke-to-output p95 | 2.57 ms |
| Maximum sampled keystroke-to-output | 4.45 ms |
| TTY clean exit / screen restoration | Passed |

Typing was measured by sending each character to the actual installed CLI's PTY and waiting for the corresponding output row. It measures application-to-PTY response, not physical monitor refresh. Model timing is one warmed preview run, not a latency SLA or a provider comparison. It distinguishes rendering delay from waiting for a model; it does not establish every possible cause of previous slow runs.

## Automated verification

- 43 console tests passed: input handling, scheduler priority, bounded history rendering, transport, local files/commands, approvals, interruption, saved sessions and recovery.
- 71 SDK/harness tests passed across seven suites: console SDK agent/endpoint, Build loop, context summarization, checkpoint boundaries and run ownership.
- Root TypeScript check and standalone console build passed.
- Installed launcher reports `rift --version` → `0.2.2`.

## Explicit limits

- This is a terminal coding-agent CLI/TUI, not a replacement operating-system shell. It can run reviewed shell commands from its own local process.
- Closing the desktop app is independent of the CLI. The configured RIFT model service must remain reachable; the current setup uses localhost:3020. Public-service deployment was not validated by this audit.
- Closing the default local CLI stops local work; `--cloud` has different producer lifetime semantics.
- Local shell commands have the user's OS permissions after approval. File tools enforce project-root boundaries; this is not an OS sandbox.
- SDK total/idle timeouts, provider errors and uncertain external side effects remain real failure boundaries. No claim of perfect execution, unlimited context, automatic replay of ambiguous edits or permanent disconnection immunity is made.
